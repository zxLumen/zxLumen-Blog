import type { UsageRow } from '@zx/shared'
import { estimateGoCost, isGoModelKnown } from '@zx/shared'
import { getDb } from './db'
import { apiCoverageStart, bjDayOffset, granularityOf, TZ, windowOf, type UsageRange } from './usage/range'
import { num, parseCsv } from './usage/csv'
import { makeTtlCache } from './usage/cache'
import { aggregateRows, isNonZeroRow } from './usage/aggregate'
import { usageError, errorCode } from './usage/errors'
import type { PlatformUsageBase } from './usage/types'

/**
 * opencode 用量:从「官方 Console」读取 **多个 workspace**(每个 workspace 一个 service key)。
 *
 * 接口:GET {consoleUrl}/api/v2/usage/export?range=30d
 * (带 service-account API Key;v2 只认 range、仅 7d/30d、按 UTC 零点对齐,返回**天级累计** CSV;
 *  2026-09-26 前是 `/api/v1/usage/export?scope=organization&range=30d` 的逐条记录 CSV,
 *  旧版现对 organization scope 返回 403,故 v2 优先、v2 404/400 时才回退 v1)。
 * 天级数据无法还原小时,「今天/昨天」分时由本站每小时采样求增量自建(见 captureHourlyOpenCode)。
 *
 * 鉴权:opencode.dev 网页登录态 / BYOK 的 `sk-` key 均被拒,**必须**用 Console
 * 里创建的 service-account key(`oc_sk_…`)。一个 key 绑定一个 workspace(官方无
 * 「按 key 查 workspace 名」接口),故 workspace 的名称由 admin 手填,留空则用 key 尾号占位。
 */

const K_LIST = 'opencode_workspaces'
const K_URL = 'opencode_console_url'
const K_ERR = 'opencode_last_error'
const K_FAIL = 'opencode_last_fail'
/** 自建小时级数据(v2 只给天级累计,靠每小时采样求差得到);按 workspace 分键 */
const kHourly = (id: string) => `opencode_hourly.${id}`
/** 上次采样到的当天累计读数(每个 workspace 一份) */
const kCum = (id: string) => `opencode_cum.${id}`
const DEFAULT_URL = 'https://opencode.ai/console'

/**
 * 官方 Console 地址(admin 里可改):
 * - `https://opencode.ai/console` —— 旧站,文档口径是 **workspace**(本站现有数据即此口径);
 * - `https://console.opencode.ai` —— 新站,文档口径是 **organization**(官方正在迁移)。
 * 两站都提供 `usage/export`(当前为 v2)且参数一致,迁移期可用 admin 一键切换。
 */
export const CONSOLE_URLS = [DEFAULT_URL, 'https://console.opencode.ai'] as const

const MAX_ROWS = 5000

export interface OcWorkspace {
  id: string
  name: string
  key: string
}

/** 名称缺省占位:key 尾 4 位(仅用于展示,不改动真实 key) */
export function wsLabel(key: string): string {
  const tail = key.trim().slice(-4)
  return tail ? `workspace-${tail}` : 'workspace'
}

function newWsId(): string {
  return `ws-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

/* ---------- 配置(meta) ---------- */

/** Console URL(全局一个);不读 env */
export const getConsoleUrl = async () => (await getDb()).getMeta(K_URL) || DEFAULT_URL
export const setConsoleUrl = async (u: string) => (await getDb()).setMeta(K_URL, u.trim().replace(/\/$/, ''))

/** 规范化单条 workspace */
function normalizeWs(raw: unknown): OcWorkspace | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const key = typeof r.key === 'string' ? r.key.trim() : ''
  if (!key) return null
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : newWsId()
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : wsLabel(key)
  return { id, name, key }
}

/** 读取 workspace 列表(缺省/非法一律空数组) */
export async function getWorkspaces(): Promise<OcWorkspace[]> {
  const raw = (await getDb()).getMeta(K_LIST)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeWs).filter((w): w is OcWorkspace => w !== null)
  } catch {
    return []
  }
}

/** 保存整表(数组顺序即展示顺序) */
export async function setWorkspaces(input: unknown): Promise<OcWorkspace[]> {
  const list = Array.isArray(input)
    ? input.map(normalizeWs).filter((w): w is OcWorkspace => w !== null)
    : []
  ;(await getDb()).setMeta(K_LIST, JSON.stringify(list))
  return list
}

export async function getLastError() {
  return (await getDb()).getMeta(K_ERR) ?? ''
}
export async function setLastError(e: string) {
  ;(await getDb()).setMeta(K_ERR, e)
}

export interface SourceFailure {
  code: string
  message: string
  at: number
}

/**
 * 最近一次拉取失败(含错误码),成功即清空。
 * 与 K_ERR(仅 admin 手动「刷新」时写)不同:这里每次自动拉取失败都记,
 * 供首页可用性探测**免网络**判定「key 已失效」→ 直接用快照,不再每次 SSR 都去撞官方 API。
 */
export async function getLastFailure(): Promise<SourceFailure | null> {
  const raw = (await getDb()).getMeta(K_FAIL)
  if (!raw) return null
  try {
    const f = JSON.parse(raw) as SourceFailure
    return typeof f?.code === 'string' ? f : null
  } catch {
    return null
  }
}
export async function setLastFailure(code: string, message: string) {
  ;(await getDb()).setMeta(K_FAIL, JSON.stringify({ code, message, at: Date.now() }))
}
export async function clearLastFailure() {
  ;(await getDb()).setMeta(K_FAIL, '')
}

const kSnap = (id: string) => `opencode_last_data.${id}`
export async function getLastData(id: string) {
  return (await getDb()).getMeta(kSnap(id)) ?? ''
}

interface Snap {
  at: number
  rows: UsageRow[]
  since: string
  grain?: Grain
}

function parseSnap(raw: string | null | undefined): Snap | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as { at?: number; rows?: UsageRow[]; since?: string; grain?: Grain }
    if (!Array.isArray(s.rows)) return null
    return { at: s.at ?? 0, rows: s.rows, since: s.since ?? '', grain: s.grain }
  } catch {
    return null
  }
}

/**
 * 全库**任意** workspace 的上次成功快照(取 rows 最多、其次 at 最新)。
 * workspace 列表被改动(删旧 / 换新 id)后,旧快照仍在 meta 里,用它兜底可避免
 * 「明明有历史数据,却因为当前 ws 没快照而整块消失」。
 */
export async function getAnySnapshot(): Promise<Snap | null> {
  const db = await getDb()
  const keys = ['opencode_last_data', ...db.listMetaKeys('opencode_last_data.')]
  let best: Snap | null = null
  for (const k of keys) {
    const s = parseSnap(db.getMeta(k))
    if (!s || s.rows.length === 0) continue
    if (!best || s.rows.length > best.rows.length || (s.rows.length === best.rows.length && s.at > best.at)) {
      best = s
    }
  }
  return best
}

/** 全部 workspace 的快照(保留,兼容旧单 key 快照键) */
export async function getSnapshotStatus(): Promise<{ at: number; count: number; since: string } | null> {
  const ws = await getWorkspaces()
  let at = 0
  let count = 0
  let since = ''
  for (const w of ws) {
    const s = parseSnap(await getLastData(w.id))
    if (!s) continue
    at = Math.max(at, s.at)
    count += s.rows.length
    since = since || s.since
  }
  if (count > 0) return { at, count, since }
  // 当前 workspace 一个快照都没有:回落到任意 workspace 的旧快照
  const any = await getAnySnapshot()
  return any ? { at: any.at, count: any.rows.length, since: any.since } : null
}

/** 是否还有「上次成功」快照(实时拉取失败时保底,避免数据源整块消失) */
export async function hasSnapshotRows(): Promise<boolean> {
  const s = await getSnapshotStatus()
  return !!s && s.count > 0
}

/* ---------- CSV 解析 ---------- */

/**
 * 解析官方 usage/export CSV → 记录(费用 microcents→USD,时间戳→ms)。
 * 两代 schema 都兼容:
 * - **v1**(旧):逐条记录,有 `created_at` / `service_account_name`,可出小时级;
 * - **v2**(现):**天级累计**,列为 `day,user_type,user_id,user_name,provider,model,requests,
 *   input_tokens,output_tokens,cache_read_tokens,cache_write_5m_tokens,cache_write_1h_tokens,
 *   cost_micro_cents,last_active_at`(无逐条时间戳、无 24h、scope 被忽略)。此时 `day` 为 UTC 日,
 *   小时级只能靠 {@link captureHourlyOpenCode} 自行采样累计值求差得到。
 */
export function parseUsageCsv(text: string): Array<{
  created: number
  /** v2 的 `day`(YYYY-MM-DD,UTC);v1 为空串 */
  day: string
  model: string
  provider: string
  /** v2=`user_name` / v1=`service_account_name`(可当 key 维度;可能为空) */
  serviceAccount: string
  /** v2 有 `requests` 列;v1 逐条记录按 1 计 */
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  billingSource: string
  /** 该模型是否已收录进 Go 价目(未收录且无实际扣费 → 费用未计) */
  pricedKnown: boolean
}> {
  const lines = parseCsv(text)
  if (lines.length < 2) return []
  const header = lines[0].map((c) => c.trim())
  const col = (name: string) => header.indexOf(name)
  const iCreated = col('created_at')
  const iDay = col('day')
  const iModel = col('model')
  const iProvider = col('provider')
  // v2 用 user_name;v1 用 service_account_name
  const iServiceAcct = iDay >= 0 ? col('user_name') : col('service_account_name')
  const iRequests = col('requests')
  const iInput = col('input_tokens')
  const iOutput = col('output_tokens')
  const iCache = col('cache_read_tokens')
  const iCacheW5 = col('cache_write_5m_tokens')
  const iCacheW1 = col('cache_write_1h_tokens')
  const iCost = col('cost_micro_cents')
  const iService = col('service')
  const iBilling = col('billing_source')
  if (iModel < 0 || iProvider < 0) return []
  if (iCreated < 0 && iDay < 0) return []

  const out: ReturnType<typeof parseUsageCsv> = []
  for (const line of lines.slice(1)) {
    const service = iService >= 0 ? line[iService] ?? '' : ''
    if (service) continue // web-search 等非推理记录(provider/model/tokens 为空)
    const day = iDay >= 0 ? String(line[iDay] ?? '').trim() : ''
    const created = day ? Date.parse(`${day}T00:00:00Z`) : Date.parse(line[iCreated] ?? '')
    const model = String(line[iModel] ?? '').trim()
    const provider = String(line[iProvider] ?? '').trim()
    if (!Number.isFinite(created) || !model || !provider) continue
    const serviceAccount = iServiceAcct >= 0 ? String(line[iServiceAcct] ?? '').trim() : ''
    const requests = iRequests >= 0 ? num(line[iRequests] ?? '') : 1
    const input = iInput >= 0 ? num(line[iInput] ?? '') : 0
    const output = iOutput >= 0 ? num(line[iOutput] ?? '') : 0
    const cacheRead = iCache >= 0 ? num(line[iCache] ?? '') : 0
    const cacheWrite =
      (iCacheW5 >= 0 ? num(line[iCacheW5] ?? '') : 0) + (iCacheW1 >= 0 ? num(line[iCacheW1] ?? '') : 0)
    const billingSource = iBilling >= 0 ? String(line[iBilling] ?? '').trim() : ''
    // 官方实际扣费(microcents→USD);Go 订阅等无扣费记录为 0
    const charged = iCost >= 0 ? num(line[iCost] ?? '') / 100000000 : 0
    // 无实际扣费时按 Go 价目折算(与 Console 网页 Cost 同口径);未收录模型记 0
    const cost =
      charged > 0
        ? charged
        : estimateGoCost(model, created, { input, output, cacheRead, cacheWrite })
    out.push({
      created,
      day,
      model,
      provider,
      serviceAccount,
      requests,
      input,
      output,
      cacheRead,
      cacheWrite,
      cost,
      billingSource,
      pricedKnown: charged > 0 || isGoModelKnown(model),
    })
  }
  return out
}

/* ---------- 拉取 + 缓存(按 workspace) ---------- */

const bjIso = (created: number) => new Date(created + TZ * 1000).toISOString()
/** 北京整点标签,如 2026-09-22T10:00:00Z(约定:日期=北京日,小时=北京时) */
const hourTs = (created: number) => `${bjIso(created).slice(0, 13)}:00:00Z`

/** 快照/拉取结果的粒度:天级(v2,默认)或小时级(旧 v1 快照) */
type Grain = 'hour' | 'day'
export interface OcRows30 {
  rows: UsageRow[]
  grain: Grain
}

const rowsCache = makeTtlCache<OcRows30>('__ocCache')

/** 拉取某 workspace 官方近 30 天导出并聚合(内存缓存 5 分钟;成功后持久化快照) */
async function fetchRows30(ws: OcWorkspace): Promise<OcRows30> {
  try {
    const data = await fetchRows30Raw(ws)
    // 成功即清除「凭证失效」记录 + 旧报错,否则首页可用性探测会一直走快照短路 / 显示过期错误
    if (await getLastFailure()) await clearLastFailure()
    if (await getLastError()) await setLastError('')
    return data
  } catch (e) {
    await setLastFailure(errorCode(e) ?? 'HTTP', e instanceof Error ? e.message : String(e))
    throw e
  }
}

/** HTTP 状态码 → 带 code 的错误 */
function httpError(status: number): Error {
  if (status === 401) {
    return usageError(
      'INVALID_KEY',
      '官方 API 拒绝访问(401):密钥无效 / 已过期 / 已吊销(需 Console 创建的 oc_sk_ 服务账号 key)',
    )
  }
  if (status === 403) {
    // 官方文档:403 = 服务账号已认证但**不被允许读用量**(权限档位问题,不是 key 无效)
    return usageError(
      'NO_PERMISSION',
      '官方 API 拒绝访问(403):该服务账号无「读取用量」权限 —— Console 里把服务账号/Key 权限改为 All permissions(inference-only 的 key 读不到用量)',
    )
  }
  return new Error(`官方 API HTTP ${status}`)
}

/**
 * 调官方 usage/export:**v2 优先**,v2 不存在(404/400)时回退 v1。
 * v2 只认 `range`(scope 被忽略),且只有 7d/30d;v1 需要 scope。
 */
async function fetchExport(ws: OcWorkspace): Promise<{ api: 'v2' | 'v1'; text: string }> {
  const key = ws.key
  if (!key) {
    throw usageError('UNCONFIGURED', '未配置 OpenCode 服务账号密钥(oc_sk_…)')
  }
  const url = await getConsoleUrl()
  const headers = { Authorization: `Bearer ${key}`, Accept: 'text/csv' }
  const get = async (path: string): Promise<Response> => {
    try {
      return await fetch(`${url}${path}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) })
    } catch (e) {
      throw new Error(e instanceof Error && e.name === 'TimeoutError' ? '官方 API 超时' : '官方 API 请求失败')
    }
  }

  const v2 = await get('/api/v2/usage/export?range=30d')
  if (v2.ok) return { api: 'v2', text: await v2.text() }
  if (v2.status !== 404 && v2.status !== 400) throw httpError(v2.status)

  const v1 = await get('/api/v1/usage/export?scope=organization&range=30d')
  if (v1.ok) return { api: 'v1', text: await v1.text() }
  throw httpError(v1.status)
}

async function fetchRows30Raw(ws: OcWorkspace): Promise<OcRows30> {
  const key = ws.key
  if (!key) {
    throw usageError('UNCONFIGURED', '未配置 OpenCode 服务账号密钥(oc_sk_…)')
  }
  const url = await getConsoleUrl()
  const ck = `${url}|${key}`
  const hit = rowsCache.get(ck)
  if (hit) return hit

  const { api, text } = await fetchExport(ws)
  const grain: Grain = api === 'v2' ? 'day' : 'hour'
  const records = parseUsageCsv(text)
  // v2 为天级累计 → ts 用当天零点;v1 为逐条 → ts 用北京整点
  const tsOf = (r: (typeof records)[number]) => (grain === 'day' ? `${r.day}T00:00:00Z` : hourTs(r.created))

  const merged = new Map<string, UsageRow>()
  for (const r of records) {
    const ts = tsOf(r)
    const k = `${ts}|${r.model}|${r.provider}|${r.serviceAccount}`
    const ex = merged.get(k)
    if (ex) {
      ex.inputTokens += r.input
      ex.outputTokens += r.output
      ex.cacheHitTokens += r.cacheRead
      ex.cost = (ex.cost ?? 0) + r.cost
      ex.requests = (ex.requests ?? 0) + r.requests
    } else if (merged.size < MAX_ROWS) {
      merged.set(k, {
        ts,
        model: r.model,
        apiKey: r.provider,
        serviceAccount: r.serviceAccount || undefined,
        inputTokens: r.input,
        outputTokens: r.output,
        cacheHitTokens: r.cacheRead,
        requests: r.requests,
        cost: r.cost,
        source: 'opencode',
      })
    }
  }
  const rows = [...merged.values()].filter(isNonZeroRow)

  ;(await getDb()).setMeta(
    kSnap(ws.id),
    JSON.stringify({ at: Date.now(), since: apiCoverageStart(), grain, rows }),
  )
  rowsCache.set(ck, { rows, grain })
  return { rows, grain }
}

/* ---------- 自建小时级数据 ---------- */

/**
 * v2 的导出是**天级累计**(`day` + 当天累计 tokens/requests/cost),没有逐条时间戳,
 * 也无法按小时查询。因此这里每小时采样一次,与上次读数相减得到**本小时增量**,
 * 按北京整点写入 `opencode_hourly`,让面板的「今天/昨天」仍能按小时展示。
 *
 * 触发:进程内定时器(每个整点前 {@link CAPTURE_BEFORE_MS} 采样,见 {@link ensureHourlyScheduler})
 * + 请求时惰性补抓。局限:进程跨过整点未运行会丢那一小时(增量并入下一小时),无法补历史。
 */
const HOUR_MS = 3_600_000
const CAPTURE_BEFORE_MS = 30_000
const HOURLY_MAX_ROWS = 8000
const HOURLY_KEEP_DAYS = 35
/** 距上次采样超过该时长则视为需要补抓 */
const STALE_MS = 55 * 60_000
/** 访问时惰性补采样阈值 */
const LAZY_MS = 5 * 60_000

interface OcCum {
  day: string
  input: number
  output: number
  cacheWrite: number
  requests: number
  cost: number
}

/** 自建小时数据(某 workspace 的全部行) */
export async function getHourlyRows(wsId: string): Promise<UsageRow[]> {
  const raw = (await getDb()).getMeta(kHourly(wsId))
  if (!raw) return []
  try {
    const s = JSON.parse(raw) as { rows?: UsageRow[] }
    return Array.isArray(s.rows) ? s.rows : []
  } catch {
    return []
  }
}

/** 上次采样时间(取所有 workspace 最新;用于惰性补抓判定) */
async function hourlyAt(): Promise<number> {
  const db = await getDb()
  let at = 0
  for (const k of db.listMetaKeys('opencode_hourly.')) {
    try {
      at = Math.max(at, (JSON.parse(db.getMeta(k) ?? '{}') as { at?: number }).at ?? 0)
    } catch {
      /* ignore */
    }
  }
  return at
}

/** 读取某 workspace 上次的当天累计读数 */
async function readCum(id: string): Promise<{ at: number; map: Record<string, OcCum> }> {
  const raw = (await getDb()).getMeta(kCum(id))
  if (!raw) return { at: 0, map: {} }
  try {
    const s = JSON.parse(raw) as { at?: number; map?: Record<string, OcCum> }
    return { at: s.at ?? 0, map: s.map ?? {} }
  } catch {
    return { at: 0, map: {} }
  }
}

/** 采样一次:各 workspace 的累计增量 → 当前小时桶 */
export async function captureHourlyOpenCode(): Promise<{ captured: number; bucket: string }> {
  const ws = await getWorkspaces()
  const db = await getDb()
  const bucket = hourTs(Date.now())
  const url = await getConsoleUrl()
  const freshAll: UsageRow[] = []

  for (const w of ws) {
    if (!w.key) continue
    let text = ''
    try {
      const res = await fetch(`${url}/api/v2/usage/export?range=30d`, {
        headers: { Authorization: `Bearer ${w.key}`, Accept: 'text/csv' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) continue
      text = await res.text()
    } catch {
      continue
    }

    // 当前累计读数,按 (day × model × provider × serviceAccount) 分键
    const cur = new Map<string, OcCum>()
    for (const r of parseUsageCsv(text)) {
      if (!r.day) continue
      const k = `${r.day}|${r.model}|${r.provider}|${r.serviceAccount}`
      const ex = cur.get(k)
      if (ex) {
        ex.input += r.input
        ex.output += r.output
        ex.cacheWrite += r.cacheWrite
        ex.requests += r.requests
        ex.cost += r.cost
      } else {
        cur.set(k, {
          day: r.day,
          input: r.input,
          output: r.output,
          cacheWrite: r.cacheWrite,
          requests: r.requests,
          cost: r.cost,
        })
      }
    }

    // 本 workspace 的增量
    const fresh: UsageRow[] = []
    const prev = await readCum(w.id)
    const baseline = prev.at === 0 // 首次采样只建立基线,不产出(否则会把当天累计全算进当前小时)
    if (!baseline) {
      for (const [k, c] of cur) {
        const p = prev.map[k]
        if (!p) continue
        const dInput = c.input - p.input
        const dOutput = c.output - p.output
        const dCache = c.cacheWrite - p.cacheWrite
        const dReq = c.requests - p.requests
        const dCost = c.cost - p.cost
        if (dInput <= 0 && dOutput <= 0 && dCache <= 0 && dReq <= 0 && dCost <= 0) continue
        const [day, model, provider, serviceAccount] = k.split('|')
        const created = Date.parse(`${day}T00:00:00Z`)
        const row: UsageRow = {
          ts: bucket,
          model,
          apiKey: provider || undefined,
          serviceAccount: serviceAccount || undefined,
          inputTokens: Math.max(0, dInput),
          outputTokens: Math.max(0, dOutput),
          cacheHitTokens: Math.max(0, dCache),
          requests: Math.max(0, dReq),
          cost:
            dCost > 0
              ? dCost
              : estimateGoCost(model, created, {
                  input: Math.max(0, dInput),
                  output: Math.max(0, dOutput),
                  cacheRead: 0,
                  cacheWrite: Math.max(0, dCache),
                }),
          source: 'opencode',
        }
        fresh.push(row)
        freshAll.push(row)
      }
    }

    // 只保留最近几天的读数,避免 meta 无限增长
    const keepFrom = bjDayOffset(-3)
    const next: Record<string, OcCum> = {}
    for (const [k, c] of cur) if (c.day >= keepFrom) next[k] = c
    db.setMeta(kCum(w.id), JSON.stringify({ at: Date.now(), map: next }))

    // 合并进本 workspace 的小时存储(同一桶多次采样累加)
    const store = await readHourly(w.id)
    const map = new Map<string, UsageRow>()
    for (const r of [...store.rows, ...fresh]) {
      const k = `${r.ts}|${r.model}|${r.apiKey ?? ''}|${r.serviceAccount ?? ''}`
      const ex = map.get(k)
      if (ex) {
        ex.inputTokens += r.inputTokens
        ex.outputTokens += r.outputTokens
        ex.cacheHitTokens += r.cacheHitTokens
        ex.requests = (ex.requests ?? 0) + (r.requests ?? 0)
        ex.cost = (ex.cost ?? 0) + (r.cost ?? 0)
      } else {
        map.set(k, { ...r })
      }
    }
    let rows = [...map.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1))
    const cutoff = bjDayOffset(-HOURLY_KEEP_DAYS)
    rows = rows.filter((r) => r.ts.slice(0, 10) >= cutoff)
    if (rows.length > HOURLY_MAX_ROWS) rows = rows.slice(rows.length - HOURLY_MAX_ROWS)
    db.setMeta(kHourly(w.id), JSON.stringify({ at: Date.now(), rows }))
  }

  return { captured: freshAll.length, bucket }
}

async function readHourly(id: string): Promise<{ at: number; rows: UsageRow[] }> {
  const raw = (await getDb()).getMeta(kHourly(id))
  if (!raw) return { at: 0, rows: [] }
  try {
    const s = JSON.parse(raw) as { at?: number; rows?: UsageRow[] }
    return { at: s.at ?? 0, rows: Array.isArray(s.rows) ? s.rows : [] }
  } catch {
    return { at: 0, rows: [] }
  }
}

/**
 * 启动自建小时采样:每个整点前 {@link CAPTURE_BEFORE_MS} 触一次(增量归到即将结束的这一小时);
 * 进程刚起来若上次采样已过期,先补抓一次。挂在 globalThis,dev 热更新不重复注册。
 */
export function ensureHourlyScheduler(): void {
  const g = globalThis as unknown as {
    __ocHourlyInit?: boolean
    __ocHourlyTimer?: ReturnType<typeof setTimeout>
    __ocHourlyBusy?: boolean
  }
  if (g.__ocHourlyInit) return
  g.__ocHourlyInit = true

  const run = runCaptureGuarded

  const schedule = () => {
    const now = Date.now()
    let next = Math.ceil((now + CAPTURE_BEFORE_MS) / HOUR_MS) * HOUR_MS - CAPTURE_BEFORE_MS
    if (next <= now) next += HOUR_MS
    g.__ocHourlyTimer = setTimeout(() => {
      void run().finally(schedule)
    }, next - now)
    ;(g.__ocHourlyTimer as unknown as { unref?: () => void }).unref?.()
  }
  schedule()

  // 启动补抓:上次采样已过期(或从未采样)时立即跑一次
  void hourlyAt().then((at) => {
    if (Date.now() - at > STALE_MS) void run()
  })
}

/** 带并发保护的采样(定时器与惰性补采样共用) */
function runCaptureGuarded(): Promise<void> {
  const g = globalThis as unknown as { __ocHourlyBusy?: boolean }
  if (g.__ocHourlyBusy) return Promise.resolve()
  g.__ocHourlyBusy = true
  return captureHourlyOpenCode()
    .then(() => {})
    .catch(() => {})
    .finally(() => {
      g.__ocHourlyBusy = false
    })
}

/** 页面/接口访问时惰性补采样:距上次 >5 分钟才跑,且不阻塞本次响应 */
export function maybeCaptureHourly(): void {
  ensureHourlyScheduler()
  void hourlyAt().then((at) => {
    if (Date.now() - at > LAZY_MS) void runCaptureGuarded()
  })
}

export interface PlatformUsageOpenCode extends PlatformUsageBase {
  providers: string[]
  granularity: 'hour' | 'day'
  platformLimit: boolean
}

/**
 * 把 30 天行按面板区间二次聚合。
 * - 今天/昨天:优先用**自建小时数据**(`hourly`,v2 只给天级),有则按小时出图;否则回退数据本身的粒度
 * - 其余区间:按天;`grain='day'`(v2)时强制天级
 * - `grain` 缺省按 `'hour'`(兼容本次改动前的旧快照)
 */
export function filterUsageOpenCode(
  rows30: UsageRow[],
  range: UsageRange,
  filter?: { start?: string; end?: string },
  opts?: { grain?: Grain; hourly?: UsageRow[] },
): PlatformUsageOpenCode {
  const { start, end } = windowOf(range, filter)
  const startMs = Date.parse(`${start}T00:00:00+08:00`)
  const endMsEx = Date.parse(`${end}T00:00:00+08:00`) + 86400000
  if (!Number.isFinite(startMs) || !Number.isFinite(endMsEx)) {
    throw new Error('区间参数无效')
  }
  const wanted = granularityOf(range)
  const grain: Grain = opts?.grain ?? 'hour'
  const platformLimit = start < apiCoverageStart()

  const inWindow = (r: UsageRow) => {
    const day = r.ts.slice(0, 10)
    return day >= start && day <= end
  }
  const within = rows30.filter(inWindow)

  // 今天/昨天:自建小时数据可用时,用它替换这些天的天级行
  let source = within
  let granularity: 'hour' | 'day' = grain === 'day' ? 'day' : wanted
  if (wanted === 'hour' && opts?.hourly?.length) {
    const hours = opts.hourly.filter(inWindow)
    if (hours.length) {
      const days = new Set(hours.map((r) => r.ts.slice(0, 10)))
      source = [...within.filter((r) => !days.has(r.ts.slice(0, 10))), ...hours]
      granularity = 'hour'
    }
  }

  let rows: UsageRow[]
  if (granularity === 'hour') {
    const merged = new Map<string, UsageRow>()
    for (const r of source) merged.set(`${r.ts}|${r.model}|${r.apiKey ?? ''}|${r.serviceAccount ?? ''}`, r)
    rows = [...merged.values()]
  } else {
    // 天级:按 (北京日 × 模型 × 提供方 × 服务账号) 合并
    rows = aggregateRows(
      source,
      (r) => `${r.ts.slice(0, 10)}|${r.model}|${r.apiKey ?? ''}|${r.serviceAccount ?? ''}`,
      (r) => ({ ...r, ts: `${r.ts.slice(0, 10)}T00:00:00Z` }),
    )
  }

  rows = rows.sort((a, b) => (a.ts < b.ts ? -1 : 1))
  const models = Array.from(new Set(rows.map((r) => r.model)))
  const providers = Array.from(new Set(rows.map((r) => r.apiKey ?? '').filter(Boolean)))
  return { rows, models, providers, currency: 'USD', granularity, start, end, platformLimit }
}

/** 拉取并聚合单个 workspace */
export async function fetchUsageOpenCodeWs(
  ws: OcWorkspace,
  range: UsageRange,
  filter?: { start?: string; end?: string },
): Promise<PlatformUsageOpenCode> {
  // 今天/昨天:顺带惰性补采样(不阻塞本次响应),让当前小时尽快出现
  if (range === 'today' || range === 'yesterday') maybeCaptureHourly()
  const { rows, grain } = await fetchRows30(ws)
  const hourly = range === 'today' || range === 'yesterday' ? await getHourlyRows(ws.id) : undefined
  return filterUsageOpenCode(rows, range, filter, { grain, hourly })
}

export interface OpenCodeMergeResult extends PlatformUsageOpenCode {
  /** 实际合并成功的 workspace 名(用于配额条分组) */
  merged: string[]
}

/**
 * 合并多个 workspace 的区间用量(全选=总用量)。
 * provider 加 `workspace 名 · ` 前缀,避免不同 ws 的同名 provider 混淆。
 */
export function mergeUsageOpenCode(
  parts: Array<{ ws: OcWorkspace; data: PlatformUsageOpenCode }>,
): OpenCodeMergeResult {
  const single = parts.length === 1
  const prefixed: UsageRow[] = []
  let granularity: 'hour' | 'day' = 'day'
  let start = ''
  let end = ''
  let platformLimit = false
  for (const { ws, data } of parts) {
    // 只要有一个 workspace 出的是小时级(今天/昨天有自建小时数据),整体就按小时
    granularity = granularity === 'hour' || data.granularity === 'hour' ? 'hour' : 'day'
    start = data.start
    end = data.end
    platformLimit = platformLimit || data.platformLimit
    for (const r of data.rows) {
      prefixed.push(
        single
          ? r
          : {
              ...r,
              apiKey: `${ws.name} · ${r.apiKey ?? ''}`,
              serviceAccount: r.serviceAccount ? `${ws.name} · ${r.serviceAccount}` : r.serviceAccount,
            },
      )
    }
  }
  const rows = aggregateRows(
    prefixed,
    (r) => `${r.ts}|${r.model}|${r.apiKey ?? ''}|${r.serviceAccount ?? ''}`,
  ).sort((a, b) => (a.ts < b.ts ? -1 : 1))
  const models = Array.from(new Set(rows.map((r) => r.model)))
  const providers = Array.from(new Set(rows.map((r) => r.apiKey ?? '').filter(Boolean)))
  return {
    rows,
    models,
    providers,
    currency: 'USD',
    granularity,
    start,
    end,
    platformLimit,
    merged: parts.map((p) => p.ws.name),
  }
}

/* ---------- Go 订阅配额(5h / 周 / 月,按 workspace) ---------- */

export interface GoQuotaWindow {
  percent: number
  status?: string
  resetsAt?: string
}
export interface GoQuota {
  rolling?: GoQuotaWindow
  weekly?: GoQuotaWindow
  monthly?: GoQuotaWindow
}

const GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const goQuotaCache = makeTtlCache<GoQuota | null>('__goQuotaCache')

/**
 * 拉取某 workspace 的 Go 订阅配额(真实百分比 + 重置时间)。
 * 未订阅 Go / key 无权限时返回 null(面板隐藏配额条)。内存缓存 5 分钟。
 */
export async function fetchGoQuotaWs(ws: OcWorkspace): Promise<GoQuota | null> {
  const key = ws.key
  if (!key) return null
  const hit = goQuotaCache.get(key)
  if (hit !== undefined) return hit

  let quota: GoQuota | null = null
  try {
    const res = await fetch(GO_USAGE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const j = (await res.json()) as { usage?: GoQuota }
      quota = j.usage ?? null
    }
  } catch {
    quota = null
  }
  goQuotaCache.set(key, quota)
  return quota
}
