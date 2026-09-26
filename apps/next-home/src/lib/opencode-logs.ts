import type { UsageRow } from '@zx/shared'
import { getDb } from './db'
import { getConsoleUrl, getWorkspaces } from './opencode'
import { bjDayOffset, windowOf, type UsageRange } from './usage/range'
import { usageError } from './usage/errors'
import { makeTtlCache } from './usage/cache'
import { isNonZeroRow } from './usage/aggregate'

/**
 * OpenCode 控制台「推理日志」(`GET /api/request-logs?category=inference`)接入。
 *
 * 控制台的 Logs → Inference 页就是用它拿**每条推理请求**(带 `startedAt` +
 * `inputTokens/outputTokens/cacheReadTokens/cost` 等),因而能得到**精确小时级**用量
 * (v2 导出只有日级)。注意:
 * - 必须带 `category=inference`;不带会拿到控制台自身的 `category:"api"` 审计日志(无 token 字段)。
 * - 必须带 `x-org-id: wrk_…`(workspace id),且各 workspace 分开拉。
 * - 只认网页登录态 Cookie(httpOnly);`oc_sk_` 打它会 403。
 *
 * 同步策略:**按 workspace 逐一分页拉取**,窗口为「北京今天」——首次/缺小时时从今天 00:00 补齐,
 * 稳态只拉当前整点(约 1 页)。「昨天」不再打接口:它在昨天当时已落库(存储保留 3 天,跨过日界)。
 */

const K_ORG = 'opencode_console_org'
const K_COOKIE = 'opencode_console_cookie'
const K_AT = 'opencode_console_at'
const K_ERR = 'opencode_console_error'
const K_ORGS = 'opencode_console_orgs'
const K_MAP = 'opencode_console_wsmap'
const K_SYNC = 'opencode_console_sync'
const K_HOURLY = 'opencode_logs_hourly'

const TZ = 28800
const HOUR = 3_600_000
/** 保留的小时行天数(需覆盖昨天) */
const KEEP_DAYS = 3
/** 非 force 时的最小同步间隔(避免每次首页/接口都打官方) */
const SYNC_MIN_MS = 2 * 60_000
/** 单次(每 workspace)最多翻页数(防呆) */
const MAX_PAGES = 80
/** 单页超时(< 客户端超时) */
const PAGE_TIMEOUT_MS = 12_000

/* ---------- 凭据 ---------- */

export const getConsoleOrg = async () => (await getDb()).getMeta(K_ORG) || ''
export const getConsoleCookie = async () => (await getDb()).getMeta(K_COOKIE) || ''
export const getConsoleAt = async () => (await getDb()).getMeta(K_AT) || ''
export const getConsoleError = async () => (await getDb()).getMeta(K_ERR) || ''
export const isConsoleConfigured = async () => !!(await getConsoleCookie())

export async function setConsoleCreds(org: string, cookie: string) {
  const db = await getDb()
  db.setMeta(K_ORG, org.trim())
  db.setMeta(K_COOKIE, extractCookie(cookie))
  db.setMeta(K_ERR, '')
}
export async function clearConsoleCreds() {
  const db = await getDb()
  for (const k of [K_ORG, K_COOKIE, K_ERR, K_ORGS, K_MAP, K_SYNC, K_HOURLY]) db.setMeta(k, '')
}
const setErr = async (e: string) => (await getDb()).setMeta(K_ERR, e)
const setAt = async (v: string) => (await getDb()).setMeta(K_AT, v)

/**
 * 从「整段 Cookie 头」/「Copy as cURL(bash/cmd)」/「Copy as fetch」/纯 cookie 串里提取 Cookie。
 * 优先只保留会话相关项;提取不到就原样保留(用户实测整段可用)。
 */
export function extractCookie(input: string): string {
  let raw = (input || '').trim()
  raw = raw.replace(/\^\s*\r?\n/g, ' ').replace(/\\"/g, '"')
  const patterns = [
    /(?:-H|--header)\s+["']?cookie:\s*([^"']+)["']?/i,
    /(?:-b|--cookie)\s+["']([^"']+)["']/i,
    /["']?cookie["']?\s*:\s*["']([^"']+)["']/i,
    /(?:^|\n)\s*cookie:\s*(.+)$/im,
  ]
  for (const re of patterns) {
    const m = raw.match(re)
    if (m?.[1] && m[1].includes('=')) {
      raw = m[1]
      break
    }
  }
  raw = raw.replace(/^['"]|['"]$/g, '').trim()
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean)
  const keep = parts.filter((p) =>
    /^(auth|console_session|__Host-console_session|_Host-console_session|__Secure-)/i.test(p),
  )
  return (keep.length ? keep : parts).join('; ')
}

/** 从「Copy as cURL / fetch」或 URL 里提取 org id(`x-org-id: wrk_…` / `organizationID=…`) */
export function extractOrg(input: string): string {
  const s = input || ''
  const byHeader = s.match(/x-org-id:\s*([A-Za-z0-9_-]+)/i)
  if (byHeader) return byHeader[1]
  const byQuery = s.match(/organizationI[Dd]=([A-Za-z0-9_-]+)/)
  if (byQuery) return byQuery[1]
  const byOrg = s.match(/["']?org(?:anization)?["']?\s*[=:]\s*["']?([A-Za-z0-9_-]+)/i)
  return byOrg ? byOrg[1] : ''
}

/* ---------- HTTP ---------- */

interface LogItem {
  id?: string
  category?: string
  outcome?: string
  statusCode?: number
  startedAt?: string | number
  provider?: string
  model?: string
  requestedModel?: string
  userID?: string
  serviceAccountID?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheWrite1hTokens?: number
  reasoningTokens?: number
  cost?: number
}

const toMs = (v: string | number | undefined): number => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const n = Date.parse(v)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

const normalizeCursor = (c: unknown): string | null => {
  if (!c) return null
  if (typeof c === 'string') return c
  try {
    return JSON.stringify(c)
  } catch {
    return null
  }
}

/** 拉一页推理日志(某 workspace) */
async function fetchPage(
  since: number,
  until: number,
  orgId: string,
  cursor?: string,
): Promise<{ items: LogItem[]; nextCursor: string | null }> {
  const db = await getDb()
  const url = await getConsoleUrl()
  const cookie = db.getMeta(K_COOKIE) || ''
  const qs = new URLSearchParams({
    since: String(since),
    until: String(until),
    limit: '100',
    category: 'inference',
  })
  if (cursor) qs.set('cursor', cursor)

  let res: Response
  try {
    res = await fetch(`${url}/api/request-logs?${qs.toString()}`, {
      headers: { Cookie: cookie, 'x-org-id': orgId },
      cache: 'no-store',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
  } catch (e) {
    throw usageError('HTTP', e instanceof Error && e.name === 'TimeoutError' ? '控制台接口超时' : '控制台接口请求失败')
  }
  if (res.status === 401 || res.status === 403) {
    throw usageError('NO_PERMISSION', '控制台会话已失效或无权限(401/403),请重新粘贴 Cookie')
  }
  if (!res.ok) throw usageError('HTTP', `控制台接口 HTTP ${res.status}`)
  const j = (await res.json()) as { items?: LogItem[]; nextCursor?: unknown }
  return { items: j.items ?? [], nextCursor: normalizeCursor(j.nextCursor) }
}

/** 分页拉完一个范围 */
async function fetchRange(since: number, until: number, orgId: string): Promise<LogItem[]> {
  const out: LogItem[] = []
  let cursor: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const { items, nextCursor } = await fetchPage(since, until, orgId, cursor)
    out.push(...items)
    if (!nextCursor || nextCursor === cursor) break
    cursor = nextCursor
  }
  return out
}

/* ---------- workspace 枚举 / 映射 ---------- */

export interface ConsoleOrg {
  id: string
  name: string
}

/** 枚举 workspace(`/api/orgs`);失败时回退到手动粘贴的单个 org */
export async function fetchOrgs(force = false): Promise<ConsoleOrg[]> {
  const db = await getDb()
  if (!force) {
    const cached = db.getMeta(K_ORGS)
    if (cached) {
      try {
        const a = JSON.parse(cached) as ConsoleOrg[]
        if (Array.isArray(a) && a.length) return a
      } catch {
        /* ignore */
      }
    }
  }
  const cookie = db.getMeta(K_COOKIE) || ''
  if (!cookie) return []
  const url = await getConsoleUrl()
  let list: ConsoleOrg[] = []
  try {
    const res = await fetch(`${url}/api/orgs`, {
      headers: { Cookie: cookie },
      cache: 'no-store',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
    if (res.ok) {
      const j = (await res.json()) as unknown
      const arr = Array.isArray(j) ? j : ((j as { items?: unknown[] })?.items ?? [])
      list = (arr as Array<Record<string, unknown>>)
        .map((x) => ({ id: String(x.id ?? ''), name: String(x.name ?? '') }))
        .filter((x) => x.id)
    }
  } catch {
    /* 回退 */
  }
  if (list.length) {
    db.setMeta(K_ORGS, JSON.stringify(list))
    return list
  }
  const pasted = db.getMeta(K_ORG) || ''
  return pasted ? [{ id: pasted, name: '' }] : []
}

export interface ConsoleWsMap {
  /** orgId(wrk_) → 本地 admin workspace */
  orgs: Record<string, { wsId: string; wsName: string }>
  /** serviceAccountID(svcacct_) → 展示名 */
  saccts: Record<string, string>
  at: number
}

const MAP_MS = 10 * 60_000

/** 用每个 admin key 调 `/api/service-accounts`,得到 org↔本地 workspace 映射与 svcacct 名称 */
export async function loadConsoleWsMap(force = false): Promise<ConsoleWsMap> {
  const db = await getDb()
  const raw = db.getMeta(K_MAP)
  if (raw && !force) {
    try {
      const m = JSON.parse(raw) as ConsoleWsMap
      if (m && Date.now() - (m.at ?? 0) < MAP_MS) return m
    } catch {
      /* ignore */
    }
  }
  const url = await getConsoleUrl()
  const orgs: ConsoleWsMap['orgs'] = {}
  const saccts: ConsoleWsMap['saccts'] = {}
  for (const w of await getWorkspaces()) {
    if (!w.key) continue
    try {
      const res = await fetch(`${url}/api/service-accounts`, {
        headers: { Authorization: `Bearer ${w.key}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      const j = (await res.json()) as { items?: Array<{ account?: { id?: string; orgId?: string; name?: string } }> }
      for (const it of j.items ?? []) {
        const a = it.account
        if (!a) continue
        if (a.orgId) orgs[a.orgId] = { wsId: w.id, wsName: w.name }
        if (a.id) saccts[a.id] = a.name || ''
      }
    } catch {
      /* 单个 key 失败不影响其余 */
    }
  }
  const map: ConsoleWsMap = { orgs, saccts, at: Date.now() }
  db.setMeta(K_MAP, JSON.stringify(map))
  return map
}

/** 只读缓存的 org→本地 workspace 映射(供路由过滤用;**绝不发起网络**,由后台同步刷新) */
export async function getConsoleWsMap(): Promise<ConsoleWsMap['orgs']> {
  try {
    const raw = (await getDb()).getMeta(K_MAP)
    if (!raw) return {}
    const m = JSON.parse(raw) as ConsoleWsMap
    return m.orgs ?? {}
  } catch {
    return {}
  }
}

/* ---------- 聚合 / 存储 ---------- */

/** 逐条日志 → 小时行(按 北京整点 × model × provider × serviceAccount 聚合) */
function aggregate(items: LogItem[], nameById: Record<string, string>): UsageRow[] {
  const map = new Map<string, UsageRow>()
  for (const it of items) {
    if (it.category && it.category !== 'inference') continue
    const input = it.inputTokens ?? 0
    const output = it.outputTokens ?? 0
    const cacheRead = it.cacheReadTokens ?? 0
    const cost = it.cost ?? 0
    if (!(input || output || cacheRead || cost)) continue
    const ms = toMs(it.startedAt)
    if (!Number.isFinite(ms)) continue
    const ts = `${new Date(ms + TZ * 1000).toISOString().slice(0, 13)}:00:00Z`
    const model = it.model || it.requestedModel || ''
    const provider = it.provider || ''
    const saId = it.serviceAccountID || ''
    const serviceAccount = nameById[saId] || saId || it.userID || ''
    const k = `${ts}|${model}|${provider}|${serviceAccount}`
    const row = map.get(k)
    if (row) {
      row.inputTokens += input
      row.outputTokens += output
      row.cacheHitTokens += cacheRead
      row.requests = (row.requests ?? 0) + 1
      row.cost = (row.cost ?? 0) + cost
    } else {
      map.set(k, {
        ts,
        model,
        apiKey: provider || undefined,
        serviceAccount: serviceAccount || undefined,
        inputTokens: input,
        outputTokens: output,
        cacheHitTokens: cacheRead,
        requests: 1,
        cost,
        source: 'opencode',
      })
    }
  }
  return [...map.values()].filter(isNonZeroRow)
}

interface HourlyStore {
  at: number
  byOrg: Record<string, UsageRow[]>
}

async function readStore(): Promise<HourlyStore> {
  const raw = (await getDb()).getMeta(K_HOURLY)
  if (!raw) return { at: 0, byOrg: {} }
  try {
    const s = JSON.parse(raw) as Partial<HourlyStore> & { rows?: UsageRow[] }
    if (s.byOrg && typeof s.byOrg === 'object') {
      return { at: s.at ?? 0, byOrg: s.byOrg }
    }
    return { at: 0, byOrg: {} }
  } catch {
    return { at: 0, byOrg: {} }
  }
}

/** 用本次拉到的小时整段覆盖旧数据(未拉到的小时保留) */
function mergeHours(prev: UsageRow[], fetched: UsageRow[]): UsageRow[] {
  const byHour = new Map<string, UsageRow[]>()
  for (const r of prev) {
    const a = byHour.get(r.ts)
    if (a) a.push(r)
    else byHour.set(r.ts, [r])
  }
  const pulled = new Set(fetched.map((r) => r.ts))
  for (const h of pulled) byHour.set(h, [])
  for (const r of fetched) {
    const a = byHour.get(r.ts)
    if (a) a.push(r)
  }
  return [...byHour.values()].flat().sort((a, b) => (a.ts < b.ts ? -1 : 1))
}

const bjHourStart = (ms: number) => Math.floor((ms + TZ * 1000) / HOUR) * HOUR - TZ * 1000

/**
 * 某 org 本次要拉的时间窗口:
 * 今天 00:00 起逐小时检查,取**最早缺失的那一小时**为起点(补齐);全都在则只拉当前整点。
 */
function windowForOrg(rows: UsageRow[], now: number): { since: number; until: number } {
  const existing = new Set(rows.map((r) => r.ts))
  const start = bjHourStart(Date.parse(`${bjDayOffset(0)}T00:00:00+08:00`))
  const current = bjHourStart(now)
  let since = current
  for (let t = start; t < current; t += HOUR) {
    const label = `${new Date(t + TZ * 1000).toISOString().slice(0, 13)}:00:00Z`
    if (!existing.has(label)) {
      since = t
      break
    }
  }
  return { since, until: now }
}

/* ---------- 同步 ---------- */

let syncing: Promise<void> | null = null
const syncDoneAt = makeTtlCache<number>('__ocLogsSync', SYNC_MIN_MS)

export interface ConsoleSyncState {
  running: boolean
  startedAt: number
  at: number
  hours: number
  orgs: number
  error: string
}

async function setSync(state: Partial<ConsoleSyncState>) {
  const db = await getDb()
  const cur = ((): ConsoleSyncState => {
    try {
      return JSON.parse(db.getMeta(K_SYNC) || '') as ConsoleSyncState
    } catch {
      return { running: false, startedAt: 0, at: 0, hours: 0, orgs: 0, error: '' }
    }
  })()
  db.setMeta(K_SYNC, JSON.stringify({ ...cur, ...state }))
}

export async function getConsoleSyncState(): Promise<ConsoleSyncState> {
  try {
    const s = JSON.parse((await getDb()).getMeta(K_SYNC) || '') as Partial<ConsoleSyncState>
    return { running: false, startedAt: 0, at: 0, hours: 0, orgs: 0, error: '', ...s }
  } catch {
    return { running: false, startedAt: 0, at: 0, hours: 0, orgs: 0, error: '' }
  }
}

/**
 * 同步一批推理日志为小时行(同时充当凭据校验:能拉到即视为有效)。
 * 失败不抛出(记录到 meta / K_SYNC),返回 `{ ok, hours, error }`。
 */
export async function syncConsoleLogs(
  opts?: { force?: boolean },
): Promise<{ ok: boolean; hours: number; error?: string }> {
  if (!(await isConsoleConfigured())) return { ok: false, hours: 0, error: '未配置控制台会话' }
  if (!opts?.force && syncDoneAt.get('t')) return { ok: true, hours: 0 }
  if (syncing) {
    await syncing
    const err = (await getDb()).getMeta(K_ERR) || undefined
    return { ok: !err, hours: 0, error: err }
  }

  await setSync({ running: true, startedAt: Date.now(), error: '', hours: 0, orgs: 0 })
  let hours = 0
  let orgCount = 0

  syncing = (async () => {
    const now = Date.now()
    const orgs = await fetchOrgs()
    if (!orgs.length) throw usageError('NO_PERMISSION', '未能枚举 workspace(/api/orgs 为空),请检查 Cookie')
    const map = await loadConsoleWsMap()
    const store = await readStore()
    const nameById = map.saccts

    for (const org of orgs) {
      const prev = store.byOrg[org.id] ?? []
      const { since, until } = windowForOrg(prev, now)
      const items = await fetchRange(since, until, org.id)
      const rows = aggregate(items, nameById)
      store.byOrg[org.id] = mergeHours(prev, rows)
      hours += new Set(rows.map((r) => r.ts)).size
      orgCount++
    }

    // 裁剪到最近 KEEP_DAYS 天
    const cutoff = bjDayOffset(-KEEP_DAYS)
    for (const orgId of Object.keys(store.byOrg)) {
      store.byOrg[orgId] = store.byOrg[orgId].filter((r) => r.ts.slice(0, 10) >= cutoff)
    }
    store.at = now

    const db = await getDb()
    db.setMeta(K_HOURLY, JSON.stringify(store))
    await setErr('')
    await setAt(new Date().toISOString())
  })()
    .catch(async (e) => {
      await setErr(e instanceof Error ? e.message : String(e))
    })
    .finally(async () => {
      syncing = null
      syncDoneAt.set('t', Date.now())
      const err = (await getDb()).getMeta(K_ERR) || ''
      await setSync({ running: false, at: Date.now(), hours, orgs: orgCount, error: err })
    })

  await syncing
  const err = (await getDb()).getMeta(K_ERR) || undefined
  return { ok: !err, hours, error: err }
}

/** 取已同步的小时行(可选按区间 / org 过滤) */
export async function getConsoleHourlyRows(
  range?: UsageRange,
  filter?: { start?: string; end?: string },
  orgIds?: string[],
): Promise<UsageRow[]> {
  const { byOrg } = await readStore()
  if (!range) return Object.values(byOrg).flat()
  const { start, end } = windowOf(range, filter)
  const out: UsageRow[] = []
  for (const [orgId, rows] of Object.entries(byOrg)) {
    if (orgIds && !orgIds.includes(orgId)) continue
    for (const r of rows) {
      const day = r.ts.slice(0, 10)
      if (day >= start && day <= end) out.push(r)
    }
  }
  return out
}

/** 是否配置了控制台会话 */
export async function consoleLogsUsable(): Promise<boolean> {
  return (await isConsoleConfigured()) && !(await getConsoleError())
}

/** 后台自动同步间隔(自带 2 分钟节流,这里放宽到 10 分钟) */
const SCHEDULE_MS = 10 * 60_000

/**
 * 启动推理日志的后台自动同步:进程首次被调用时补跑一次,之后每 {@link SCHEDULE_MS} 跑一次
 * (幂等,挂 globalThis,dev 热更新不重复注册)。这样即便零访问也不会丢小时,无需手动点同步。
 */
export function ensureLogsScheduler(): void {
  const g = globalThis as unknown as {
    __ocLogsInit?: boolean
    __ocLogsTimer?: ReturnType<typeof setInterval>
  }
  if (g.__ocLogsInit) return
  g.__ocLogsInit = true

  const tick = () => {
    void isConsoleConfigured()
      .then((on) => {
        if (on) return syncConsoleLogs()
      })
      .catch(() => {
        /* 失败已记 meta;下个周期重试 */
      })
  }
  tick() // 启动补跑(内部按 2 分钟节流,刚跑过则跳过)
  g.__ocLogsTimer = setInterval(tick, SCHEDULE_MS)
  ;(g.__ocLogsTimer as unknown as { unref?: () => void }).unref?.()
}
