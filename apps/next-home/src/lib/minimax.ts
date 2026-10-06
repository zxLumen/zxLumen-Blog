import crypto from 'node:crypto'
import type { UsageRow } from '@zx/shared'
import { getDb } from './db'
import { windowOf, type UsageFilter, type UsageRange } from './usage/range'
import { invalidateAvailability } from './usage-sources'
import { usageError } from './usage/errors'
import type { PlatformUsageBase } from './usage/types'

/**
 * MiniMax 开放平台用量数据源。
 *
 * 关键约束:MiniMax **没有公开的用量 REST API**(open API 仅暴露推理),
 * 真实接口在控制台内部(`www.minimax.cn`),鉴权靠**网页登录凭证**。
 *
 * 与 DeepSeek/OpenCode Console 同款「**书签授权一次 → 服务器定时自动拉**」:
 *  - 书签在 `*.minimax.cn` 控制台页面上点,读出 JS 可读的凭证
 *    (`_token` cookie 等 + `access_token`)POST 到本站 `/api/admin/minimax/token`;
 *  - 服务器保存凭证后 `ensureMinimaxScheduler()` 每 10 分钟自动拉
 *    `GET /account/amount`(分页) → 按 (天×模型×API Key) 聚合 → 入库;
 *  - 前端读库内快照,任意区间本地过滤,零延迟。
 *
 * 备用路径:书签也可直接把原始 records 推到 `/api/admin/minimax/sync`
 * (`setMinimaxSyncData`),当凭证读不到/服务端拉不动时可兜底。
 */

const K_SYNC = 'minimax_sync_key'
const K_SYNC_AT = 'minimax_sync_at'
const K_DATA = 'minimax_sync_data'
const K_ERR = 'minimax_last_error'
const K_COOKIE = 'minimax_cookie'
const K_GROUP = 'minimax_group_id'
const K_AUTH_AT = 'minimax_auth_at'
const K_AUTH_ERR = 'minimax_auth_error'

/** 控制台 API 基址(可被 env 覆盖,便于国际站 minimax.io) */
const BASE = (process.env.MINIMAX_BASE_URL || 'https://www.minimax.cn').replace(/\/$/, '')
const AMOUNT_PATH = '/account/amount'
const OVERVIEW_PATH = '/backend/account/token_plan/usage_overview'
const SUMMARY_PATH = '/backend/account/token_plan/usage_summary'

/* ---------- meta 存取 ---------- */

export async function getSyncKey(): Promise<string> {
  const db = getDb()
  let k = db.getMeta(K_SYNC)
  if (!k) {
    k = crypto.randomBytes(16).toString('hex')
    db.setMeta(K_SYNC, k)
  }
  return k
}

export async function rotateSyncKey(): Promise<string> {
  const k = crypto.randomBytes(16).toString('hex')
  getDb().setMeta(K_SYNC, k)
  return k
}

/**
 * 校验跨站同步密钥(来自 minimax.cn 控制台)。
 *
 * 书签 POST 是**跨站**请求,浏览器不会携带 SameSite=Lax 的 `zx_admin`
 * cookie,服务端无法靠 cookie 判断身份,用「密钥匹配库中已存同步密钥」
 * 校验。轮换后旧密钥立即失效。
 */
export function verifySyncKey(key: string): boolean {
  if (!key) return false
  return getDb().getMeta(K_SYNC) === key
}

export const getLastError = async () => getDb().getMeta(K_ERR) ?? ''
export const setLastError = async (e: string) => getDb().setMeta(K_ERR, e)

/* ---------- 凭证 ---------- */

export const getMinimaxCookie = async () => getDb().getMeta(K_COOKIE) ?? ''
export const getMinimaxGroupId = async () => getDb().getMeta(K_GROUP) ?? ''
export const getAuthAt = async () => getDb().getMeta(K_AUTH_AT) ?? ''
export const getAuthError = async () => getDb().getMeta(K_AUTH_ERR) ?? ''
export const setAuthError = async (e: string) => getDb().setMeta(K_AUTH_ERR, e)

/** 保存书签同步来的登录凭证(不影响已存快照) */
export async function setMinimaxCredential(cookie: string, groupId: string): Promise<void> {
  const db = getDb()
  db.setMeta(K_COOKIE, cookie.trim())
  db.setMeta(K_GROUP, (groupId || '').trim())
  db.setMeta(K_AUTH_AT, new Date().toISOString())
  db.setMeta(K_AUTH_ERR, '')
}

/** 清除凭证(停自动同步) */
export function clearMinimaxCredential(): void {
  const db = getDb()
  db.setMeta(K_COOKIE, '')
  db.setMeta(K_GROUP, '')
  db.setMeta(K_AUTH_AT, '')
  db.setMeta(K_AUTH_ERR, '')
}

/* ---------- 数据类型 ---------- */

export interface MinimaxStoredRecord {
  /** 消费时间(原样保留,聚合时取前 10 位作为北京日) */
  consume_time?: string
  model?: string
  api_token_name?: string
  consume_input_token?: number
  consume_output_token?: number
  consume_token?: number
  consume_cash?: number
  consume_cash_after_voucher?: number
  [k: string]: unknown
}

export interface MinimaxSyncPayload {
  /** 书签同步的区间(YYYY-MM-DD,北京日) */
  start?: string
  end?: string
  /** 控制台原始 records(已由书签分页拉完) */
  records?: MinimaxStoredRecord[]
  /** usage_summary 配额原始响应(结构未知,先原样存,按需渲染) */
  quota?: unknown
}

export interface MinimaxStored {
  at: number
  start: string
  end: string
  rows: UsageRow[]
  quota: unknown | null
  records: number
}

/* 单条 record → 一行 UsageRow(按天/模型/Key 聚合) */
function dayOf(consume_time: string | undefined): string {
  if (!consume_time) return ''
  // 容忍 ISO "2026-10-06T12:34:56..." 或 "2026-10-06 12:34:56" 或纯 "2026-10-06"
  const m = String(consume_time).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 聚合 records → UsageRow[];返回 rows 与原始条数 */
export function aggregateMinimaxRecords(records: MinimaxStoredRecord[]): { rows: UsageRow[]; rawCount: number } {
  type K = string
  const map = new Map<K, { day: string; model: string; key: string; in: number; out: number; req: number; cost: number }>()
  for (const r of records || []) {
    const day = dayOf(r.consume_time)
    const model = String(r.model ?? '').trim() || '(unknown)'
    const key = String(r.api_token_name ?? '').trim()
    const inT = num(r.consume_input_token)
    const outT = num(r.consume_output_token)
    // 优先用券后金额(与官网「实际扣费」口径一致);缺则回退现金消费
    const cash =
      r.consume_cash_after_voucher != null && Number(r.consume_cash_after_voucher) >= 0
        ? num(r.consume_cash_after_voucher)
        : num(r.consume_cash)
    const k = `${day}|${model}|${key}`
    const cur = map.get(k)
    if (cur) {
      cur.in += inT
      cur.out += outT
      cur.req += 1
      cur.cost += cash
    } else {
      map.set(k, { day, model, key, in: inT, out: outT, req: 1, cost: cash })
    }
  }
  const rows: UsageRow[] = []
  for (const v of map.values()) {
    if (!v.day) continue
    // 总额为 0 且无费用:跳过纯零行(避免脏数据稀释模型选单)
    if (v.in === 0 && v.out === 0 && v.cost === 0) continue
    rows.push({
      ts: `${v.day}T00:00:00Z`,
      model: v.model,
      inputTokens: v.in,
      outputTokens: v.out,
      cacheHitTokens: 0,
      requests: v.req,
      source: 'minimax',
      apiKey: v.key || undefined,
      cost: v.cost > 0 ? Math.round(v.cost * 10000) / 10000 : undefined,
    })
  }
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.model.localeCompare(b.model)))
  return { rows, rawCount: records?.length ?? 0 }
}

/** 落库一次快照(允许空 rows);清错误、失效可用性缓存 */
function commitSnapshot(start: string, end: string, records: MinimaxStoredRecord[], quota: unknown): MinimaxStored {
  const { rows, rawCount } = aggregateMinimaxRecords(records)
  const stored: MinimaxStored = {
    at: Date.now(),
    start,
    end,
    rows,
    quota: quota ?? null,
    records: rawCount,
  }
  const db = getDb()
  db.setMeta(K_DATA, JSON.stringify(stored))
  db.setMeta(K_SYNC_AT, new Date().toISOString())
  db.setMeta(K_ERR, '')
  db.setMeta(K_AUTH_ERR, '')
  invalidateAvailability()
  return stored
}

/** 写入书签直推的同步数据;记录为空时抛错(直推路径不允许空) */
export function setMinimaxSyncData(payload: MinimaxSyncPayload): MinimaxStored {
  const start = String(payload.start ?? '').slice(0, 10)
  const end = String(payload.end ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('start/end 需为 YYYY-MM-DD')
  }
  if (start > end) throw new Error('start 需 ≤ end')
  const recs = Array.isArray(payload.records) ? payload.records : []
  if (recs.length === 0) throw new Error('records 为空')
  const stored = commitSnapshot(start, end, recs, payload.quota)
  if (stored.rows.length === 0) throw new Error('聚合后无可用记录(全部为空)')
  return stored
}

/** 读取最近一次同步的快照(原样);用于 admin 状态展示 */
export function getLastSync(): MinimaxStored | null {
  const raw = getDb().getMeta(K_DATA)
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as MinimaxStored
    return s && Array.isArray(s.rows) ? s : null
  } catch {
    return null
  }
}

/** 清除同步数据 + 凭证(停自动同步) */
export function clearMinimaxData(): void {
  const db = getDb()
  db.setMeta(K_DATA, '')
  db.setMeta(K_SYNC_AT, '')
  db.setMeta(K_ERR, '')
  clearMinimaxCredential()
  invalidateAvailability()
}

/* ---------- 服务器端拉取(自动同步) ---------- */

interface AmountResp {
  base_resp?: { status_code?: number; status_msg?: string }
  charge_records?: MinimaxStoredRecord[]
  total_cnt?: number
  consume_token_sum?: number
  consume_cash_after_voucher_sum?: number
}

/** 区分「授权失效」与其它错误,便于上层决定是否停止重试 */
function classifyStatus(status: number, msg?: string): never {
  if (status === 401 || status === 403) {
    throw usageError('INVALID_TOKEN', msg || `授权失效(HTTP ${status}),请重新点书签授权`)
  }
  throw usageError('HTTP', msg || `接口返回错误(HTTP ${status})`)
}

async function fetchAmountPage(cookie: string, groupId: string, params: URLSearchParams): Promise<AmountResp> {
  let res: Response
  try {
    res = await fetch(`${BASE}${AMOUNT_PATH}?${params.toString()}`, {
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
        ...(groupId ? { 'X-Group-Id': groupId } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    throw usageError(
      e instanceof Error && e.name === 'TimeoutError' ? 'TIMEOUT' : 'HTTP',
      e instanceof Error && e.name === 'TimeoutError' ? 'MiniMax 接口超时' : 'MiniMax 接口请求失败',
    )
  }
  const json = (await res.json().catch(() => null)) as AmountResp | null
  if (!json) classifyStatus(res.status)
  const sc = json.base_resp?.status_code
  if (sc === 1004 || sc === 1005) {
    throw usageError('INVALID_TOKEN', json.base_resp?.status_msg || '授权失效,请重新点书签授权')
  }
  if (sc !== undefined && sc !== 0) {
    throw usageError('HTTP', json.base_resp?.status_msg || `接口返回 ${sc}`)
  }
  if (res.status === 401 || res.status === 403) classifyStatus(res.status, json.base_resp?.status_msg)
  return json
}

/** 分页拉全区间 records;`limit` 若被上游拒绝则逐级下调 */
async function fetchAllRecords(cookie: string, groupId: string, start: string, end: string): Promise<MinimaxStoredRecord[]> {
  const limits = [100, 50, 20, 10]
  const MAX_PAGE = 40
  let first: AmountResp | null = null
  let limit = limits[0]
  let lastErr: unknown = null
  for (const l of limits) {
    const params = new URLSearchParams({
      start_date: start,
      end_date: end,
      aggregate: 'true',
      page: '1',
      limit: String(l),
    })
    try {
      first = await fetchAmountPage(cookie, groupId, params)
      limit = l
      break
    } catch (e) {
      lastErr = e
      const code = (e as { code?: string }).code
      // 授权/超时类错误不必换 limit,直接抛
      if (code === 'INVALID_TOKEN' || code === 'TIMEOUT') throw e
      // 其余(如 invalid params)换更小 limit 再试
      first = null
    }
  }
  if (!first) throw lastErr ?? usageError('HTTP', '拉取失败')
  const records: MinimaxStoredRecord[] = Array.isArray(first.charge_records) ? [...first.charge_records] : []
  let total = typeof first.total_cnt === 'number' ? first.total_cnt : 0
  let page = 1
  while (page < MAX_PAGE && total > 0 && records.length < total) {
    page++
    const params = new URLSearchParams({
      start_date: start,
      end_date: end,
      aggregate: 'true',
      page: String(page),
      limit: String(limit),
    })
    const j = await fetchAmountPage(cookie, groupId, params)
    const recs = Array.isArray(j.charge_records) ? j.charge_records : []
    if (recs.length === 0) break
    records.push(...recs)
    if (typeof j.total_cnt === 'number') total = j.total_cnt
  }
  return records
}

/** 配额摘要(token_plan/usage_summary);失败不阻断主流程,返回 null */
async function fetchQuotaSummary(cookie: string, groupId: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${BASE}${SUMMARY_PATH}`, {
      headers: { Cookie: cookie, Accept: 'application/json', ...(groupId ? { 'X-Group-Id': groupId } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as { base_resp?: { status_code?: number }; data?: unknown } | null
    if (!j || (j.base_resp?.status_code !== undefined && j.base_resp.status_code !== 0)) return null
    return j.data ?? j
  } catch {
    return null
  }
}

/**
 * M Plan 用量总览(token_plan/usage_overview):返回按天×模型的 token。
 * `date_model_usage: [{ date, total_token, cache_hit_percent, models: [{ model, input_token, output_token }] }]`
 * `period` 仅支持 day/7d/30d,统一取 30d;返回 `applicable=false` 表示该接口不适用(调用方可回退按量付费接口)。
 */
interface OverviewModel {
  model?: string
  input_token?: number
  output_token?: number
  total_token?: number
  cache_hit_percent?: number
}
interface OverviewDay {
  date?: string
  total_token?: number
  cache_hit_percent?: number
  models?: OverviewModel[]
}

/** date_model_usage → 通用 records(复用既有聚合) */
export function recordsFromOverview(days: OverviewDay[] | undefined): MinimaxStoredRecord[] {
  const out: MinimaxStoredRecord[] = []
  for (const d of days || []) {
    const date = String(d?.date ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    for (const m of d.models || []) {
      const model = String(m?.model ?? '').trim()
      if (!model) continue
      out.push({
        consume_time: date,
        model,
        consume_input_token: num(m.input_token),
        consume_output_token: num(m.output_token),
      })
    }
  }
  return out
}

async function fetchOverview(
  cookie: string,
  groupId: string,
): Promise<{ applicable: boolean; records: MinimaxStoredRecord[]; raw: unknown | null }> {
  let res: Response
  try {
    res = await fetch(`${BASE}${OVERVIEW_PATH}?period=30d`, {
      headers: { Cookie: cookie, Accept: 'application/json', ...(groupId ? { 'X-Group-Id': groupId } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    throw usageError(
      e instanceof Error && e.name === 'TimeoutError' ? 'TIMEOUT' : 'HTTP',
      e instanceof Error && e.name === 'TimeoutError' ? 'MiniMax 接口超时' : 'MiniMax 接口请求失败',
    )
  }
  const j = (await res.json().catch(() => null)) as
    | { base_resp?: { status_code?: number; status_msg?: string }; data?: unknown; date_model_usage?: OverviewDay[] }
    | null
  const sc = j?.base_resp?.status_code
  if (res.status === 401 || res.status === 403 || sc === 1004 || sc === 1005) {
    throw usageError('INVALID_TOKEN', j?.base_resp?.status_msg || `授权失效(HTTP ${res.status}),请重新授权`)
  }
  // 非 0 业务码 / 非 200:视为「该接口不适用」,交给调用方回退
  if (!res.ok || !j || (sc !== undefined && sc !== 0)) {
    return { applicable: false, records: [], raw: j ?? null }
  }
  const body = (j.data && typeof j.data === 'object' ? (j.data as Record<string, unknown>) : j) as {
    date_model_usage?: OverviewDay[]
  }
  return { applicable: true, records: recordsFromOverview(body.date_model_usage), raw: body }
}

/**
 * 用已存凭证从服务器直连拉取并落库(自动同步核心)。
 * 优先 M Plan `usage_overview`;不适用时回退按量付费 `/account/amount`。
 * 授权失效抛 `INVALID_TOKEN`,由调度器记录后停摆。
 */
export async function fetchMinimaxUsageFromServer(range: UsageRange = '30d'): Promise<MinimaxStored> {
  const cookie = await getMinimaxCookie()
  if (!cookie) throw usageError('UNCONFIGURED', '尚未授权(请在控制台点书签)')
  const groupId = await getMinimaxGroupId()
  const { start, end } = windowOf(range)
  const ov = await fetchOverview(cookie, groupId)
  let records = ov.records
  if (!ov.applicable) {
    // 非 M Plan(或 overview 不可用):按量付费接口
    records = await fetchAllRecords(cookie, groupId, start, end)
  }
  const quota = await fetchQuotaSummary(cookie, groupId)
  return commitSnapshot(start, end, records, quota ?? ov.raw)
}

/* ---------- 后台自动同步调度 ---------- */

/** 自动同步间隔 */
const SCHEDULE_MS = 10 * 60_000

/**
 * 启动 MiniMax 后台自动同步:进程首次被调用时补跑一次,之后每 {@link SCHEDULE_MS}
 * 跑一次(幂等,挂 globalThis,dev 热更新不重复注册)。无凭证或凭证已知失效时跳过,
 * 不空转;重新授权(清 auth_error)后自动恢复。
 */
export function ensureMinimaxScheduler(): void {
  const g = globalThis as unknown as { __mmInit?: boolean; __mmTimer?: ReturnType<typeof setInterval> }
  if (g.__mmInit) return
  g.__mmInit = true

  const tick = () => {
    void (async () => {
      try {
        if (!(await getMinimaxCookie())) return
        if (await getAuthError()) return // 授权失效,等重新授权
        await fetchMinimaxUsageFromServer('30d')
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'INVALID_TOKEN' || code === 'UNCONFIGURED') {
          await setAuthError(e instanceof Error ? e.message : '授权失效,请重新点书签授权')
          invalidateAvailability()
        }
        // 其它错误(网络/超时)忽略,下个周期自动重试
      }
    })()
  }

  tick() // 启动补跑
  g.__mmTimer = setInterval(tick, SCHEDULE_MS)
  ;(g.__mmTimer as unknown as { unref?: () => void }).unref?.()
}

/* ---------- 用量接口(纯本地,不打网络) ---------- */

export interface PlatformUsageMinimax extends PlatformUsageBase {
  source: 'minimax'
  models: string[]
  apiKeys: string[]
}

/**
 * 从本地快照读取区间内用量(零延迟)。
 * 若快照不存在/为空 → 返回空结果(由 UI 提示「未同步」)。
 */
export function getMinimaxUsage(range: UsageRange, filter?: UsageFilter): PlatformUsageMinimax {
  const stored = getLastSync()
  const win = windowOf(range, filter)
  const start = win.start
  const end = win.end
  const rows: UsageRow[] = []
  if (stored?.rows?.length) {
    for (const r of stored.rows) {
      const day = r.ts.slice(0, 10)
      if (day >= start && day <= end) rows.push(r)
    }
  }
  const models = Array.from(new Set(rows.map((r) => r.model))).sort()
  const apiKeys = Array.from(new Set(rows.map((r) => r.apiKey ?? '').filter(Boolean))).sort()
  return {
    source: 'minimax',
    rows,
    models,
    apiKeys,
    currency: 'CNY',
    granularity: 'day',
    start,
    end,
  }
}

/** 是否有近期(30 天)数据;供面板可用性探测 */
export function hasMinimaxData(): boolean {
  const stored = getLastSync()
  if (!stored?.rows?.length) return false
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const maxDay = stored.rows.reduce((m, r) => (r.ts.slice(0, 10) > m ? r.ts.slice(0, 10) : m), '')
  return !!maxDay && maxDay >= cutoff
}

/** admin 状态摘要 */
export async function getSnapshotStatus(): Promise<{ at: number; count: number; start?: string; end?: string } | null> {
  const stored = getLastSync()
  if (!stored) return null
  return { at: stored.at, count: stored.rows.length, start: stored.start, end: stored.end }
}
