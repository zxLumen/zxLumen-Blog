import type { UsageRow } from '@zx/shared'
import { estimateGoCost, isGoModelKnown } from '@zx/shared'
import { getDb } from './db'
import { windowOf, type UsageRange } from './deepseek'

/**
 * opencode 用量:从「官方 Console」读取组织内全部用量。
 *
 * 接口:GET {consoleUrl}/api/v1/usage/export?scope=organization&range=30d
 * (带 service-account API Key;仅支持 24h / 7d / 30d,按 UTC 零点对齐)。
 * 返回逐条记录的 CSV,含精确时间戳,因此可本地按北京时/日聚合成任意面板区间。
 *
 * 鉴权:opencode.dev 网页登录态 / BYOK 的 `sk-` key 均被拒,**必须**用 Console
 * 里创建的 service-account key(`oc_sk_…`),优先级 env OPENCODE_SERVICE_KEY > meta。
 */

const K_URL = 'opencode_console_url'
const K_KEY = 'opencode_service_key'
const K_ERR = 'opencode_last_error'
const K_DATA = 'opencode_last_data'

const TZ = 28800 // 北京时间 UTC+8
const MAX_ROWS = 5000
const CACHE_TTL = 5 * 60 * 1000

/* ---------- 配置(meta / env) ---------- */

export const getConsoleUrl = async () =>
  process.env.OPENCODE_CONSOLE_URL || (await getDb()).getMeta(K_URL) || 'https://opencode.ai/console'
export const getServiceKey = async () =>
  process.env.OPENCODE_SERVICE_KEY || (await getDb()).getMeta(K_KEY) || ''
export const setConsoleUrl = async (u: string) => (await getDb()).setMeta(K_URL, u.trim())
export const setServiceKey = async (k: string) => (await getDb()).setMeta(K_KEY, k.trim())

export const getLastError = async () => (await getDb()).getMeta(K_ERR) ?? ''
export const setLastError = async (e: string) => (await getDb()).setMeta(K_ERR, e)
export const getLastData = async () => (await getDb()).getMeta(K_DATA) ?? ''
export const clearLastData = async () => (await getDb()).setMeta(K_DATA, '')

/** 官方 30d 窗口起点(UTC 零点 - 29 天)对应的北京日标签;早于它的区间官方覆盖不到 */
const apiCoverageStart = () =>
  new Date(Math.floor(Date.now() / 86400000) * 86400000 - 29 * 86400000 + TZ * 1000)
    .toISOString()
    .slice(0, 10)

/* ---------- CSV 解析 ---------- */

/** 极简 CSV 解析(处理引号/转义/CRLF/UTF-8 BOM) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQ = false
  const src = text.replace(/^\ufeff/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQ = false
      } else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      cur.push(field)
      field = ''
    } else if (ch === '\n') {
      cur.push(field)
      rows.push(cur)
      cur = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field !== '' || cur.length) {
    cur.push(field)
    rows.push(cur)
  }
  return rows.filter((r) => r.length && r.some((c) => c.trim() !== ''))
}

const num = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 解析官方 usage/export CSV → 逐条记录(费用 microcents→USD,时间戳→ms) */
export function parseUsageCsv(text: string): Array<{
  created: number
  model: string
  provider: string
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
  const iModel = col('model')
  const iProvider = col('provider')
  const iInput = col('input_tokens')
  const iOutput = col('output_tokens')
  const iCache = col('cache_read_tokens')
  const iCacheW5 = col('cache_write_5m_tokens')
  const iCacheW1 = col('cache_write_1h_tokens')
  const iCost = col('cost_micro_cents')
  const iService = col('service')
  const iBilling = col('billing_source')
  if (iCreated < 0 || iModel < 0 || iProvider < 0) return []

  const out: ReturnType<typeof parseUsageCsv> = []
  for (const line of lines.slice(1)) {
    const service = iService >= 0 ? line[iService] ?? '' : ''
    if (service) continue // web-search 等非推理记录(provider/model/tokens 为空)
    const created = Date.parse(line[iCreated] ?? '')
    const model = String(line[iModel] ?? '').trim()
    const provider = String(line[iProvider] ?? '').trim()
    if (!Number.isFinite(created) || !model || !provider) continue
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
      model,
      provider,
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

/* ---------- 拉取 + 缓存 ---------- */

const bjIso = (created: number) => new Date(created + TZ * 1000).toISOString()
/** 北京整点标签,如 2026-09-22T10:00:00Z(约定:日期=北京日,小时=北京时) */
const hourTs = (created: number) => `${bjIso(created).slice(0, 13)}:00:00Z`

const g = globalThis as unknown as {
  __ocCache?: Map<string, { at: number; rows: UsageRow[] }>
}
const cacheKey = async () => `${await getConsoleUrl()}|${await getServiceKey()}`

/** 拉取官方近 30 天导出并聚合成小时级 rows30(内存缓存 5 分钟;成功后持久化快照供回退) */
async function fetchRows30(): Promise<UsageRow[]> {
  const key = await getServiceKey()
  if (!key) {
    const e = new Error('未配置 OpenCode 服务账号密钥(oc_sk_…)')
    ;(e as { code?: string }).code = 'UNCONFIGURED'
    throw e
  }
  const ck = await cacheKey()
  g.__ocCache ??= new Map()
  const hit = g.__ocCache.get(ck)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rows

  const url = `${await getConsoleUrl()}/api/v1/usage/export`
  let res: Response
  try {
    res = await fetch(`${url}?scope=organization&range=30d`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'text/csv' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'TimeoutError' ? '官方 API 超时' : '官方 API 请求失败')
  }
  if (res.status === 401 || res.status === 403) {
    const e = new Error('官方 API 拒绝访问:密钥无效或无权限(需 Console 创建的 oc_sk_ 服务账号 key)')
    ;(e as { code?: string }).code = 'INVALID_KEY'
    throw e
  }
  if (!res.ok) throw new Error(`官方 API HTTP ${res.status}`)
  const text = await res.text()

  const records = parseUsageCsv(text)
  // 聚合为小时级(权限最大粒度),供任意区间二次聚合/回退
  const merged = new Map<string, UsageRow>()
  for (const r of records) {
    const k = `${hourTs(r.created)}|${r.model}|${r.provider}`
    const ex = merged.get(k)
    if (ex) {
      ex.inputTokens += r.input
      ex.outputTokens += r.output
      ex.cacheHitTokens += r.cacheRead
      ex.cost = (ex.cost ?? 0) + r.cost
      ex.requests = (ex.requests ?? 0) + 1
    } else if (merged.size < MAX_ROWS) {
      merged.set(k, {
        ts: hourTs(r.created),
        model: r.model,
        apiKey: r.provider,
        inputTokens: r.input,
        outputTokens: r.output,
        cacheHitTokens: r.cacheRead,
        requests: 1,
        cost: r.cost,
        source: 'opencode',
      })
    }
  }
  const rows = [...merged.values()].filter(
    (r) => r.inputTokens + r.outputTokens > 0 || (r.cost ?? 0) > 0 || (r.requests ?? 0) > 0,
  )

  await setLastError('')
  ;(await getDb()).setMeta(
    K_DATA,
    JSON.stringify({ at: Date.now(), since: apiCoverageStart(), rows }),
  )
  g.__ocCache.set(ck, { at: Date.now(), rows })
  return rows
}

export interface PlatformUsageOpenCode {
  rows: UsageRow[]
  models: string[]
  providers: string[]
  currency: string
  granularity: 'hour' | 'day'
  start: string
  end: string
  platformLimit: boolean
}

/** 从 rows30(小时级)按面板区间二次聚合;今天/昨天按小时,其余按天 */
export function filterUsageOpenCode(
  rows30: UsageRow[],
  range: UsageRange,
  filter?: { start?: string; end?: string },
): PlatformUsageOpenCode {
  const { start, end } = windowOf(range, filter)
  const startMs = Date.parse(`${start}T00:00:00+08:00`)
  const endMsEx = Date.parse(`${end}T00:00:00+08:00`) + 86400000
  if (!Number.isFinite(startMs) || !Number.isFinite(endMsEx)) {
    throw new Error('区间参数无效')
  }
  const granularity: 'hour' | 'day' = range === 'today' || range === 'yesterday' ? 'hour' : 'day'
  const platformLimit = start < apiCoverageStart()

  const inWin = (t: string) => {
    const day = t.slice(0, 10)
    return day >= start && day <= end
  }
  const within = rows30.filter((r) => inWin(r.ts))

  const merged = new Map<string, UsageRow>()
  if (granularity === 'hour') {
    for (const r of within) {
      const k = `${r.ts}|${r.model}|${r.apiKey ?? ''}`
      merged.set(k, r)
    }
  } else {
    // 天级:按 (北京日 × 模型 × 提供方) 合并
    for (const r of within) {
      const day = r.ts.slice(0, 10)
      const k = `${day}|${r.model}|${r.apiKey ?? ''}`
      const ex = merged.get(k)
      if (ex) {
        ex.inputTokens += r.inputTokens
        ex.outputTokens += r.outputTokens
        ex.cacheHitTokens += r.cacheHitTokens
        ex.requests = (ex.requests ?? 0) + (r.requests ?? 0)
        ex.cost = (ex.cost ?? 0) + (r.cost ?? 0)
      } else {
        merged.set(k, { ...r, ts: `${day}T00:00:00Z` })
      }
    }
  }

  const rows = [...merged.values()].sort((a, b) => (a.ts < b.ts ? -1 : 1))
  const models = Array.from(new Set(rows.map((r) => r.model)))
  const providers = Array.from(new Set(rows.map((r) => r.apiKey ?? '').filter(Boolean)))
  return { rows, models, providers, currency: 'USD', granularity, start, end, platformLimit }
}

export async function fetchUsageOpenCode(
  range: UsageRange,
  filter?: { start?: string; end?: string },
): Promise<PlatformUsageOpenCode> {
  const rows30 = await fetchRows30()
  return filterUsageOpenCode(rows30, range, filter)
}

/** 上次成功快照的状态(admin 用) */
export async function getSnapshotStatus(): Promise<{ at: number; count: number; since: string } | null> {
  const raw = await getLastData()
  if (!raw) return null
  try {
    const snap = JSON.parse(raw) as { at?: number; rows?: UsageRow[]; since?: string }
    if (!Array.isArray(snap.rows)) return null
    return { at: snap.at ?? 0, count: snap.rows.length, since: snap.since ?? '' }
  } catch {
    return null
  }
}

/* ---------- Go 订阅配额(5h / 周 / 月) ---------- */

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
const gq = globalThis as unknown as { __goQuotaCache?: { at: number; quota: GoQuota | null } }

/**
 * 拉取 Go 订阅配额(真实百分比 + 重置时间)。
 * 需 service-account key;未订阅 Go / key 无权限时返回 null(面板隐藏配额条)。
 * 内存缓存 5 分钟。
 */
export async function fetchGoQuota(): Promise<GoQuota | null> {
  const key = await getServiceKey()
  if (!key) return null
  gq.__goQuotaCache ??= { at: 0, quota: null }
  if (Date.now() - gq.__goQuotaCache.at < CACHE_TTL) return gq.__goQuotaCache.quota

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
  gq.__goQuotaCache = { at: Date.now(), quota }
  return quota
}