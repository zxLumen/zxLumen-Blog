import crypto from 'node:crypto'
import type { UsageRow } from '@zx/shared'
import { getDb } from './db'
import { windowOf, type UsageFilter, type UsageRange } from './usage/range'
import { invalidateAvailability } from './usage-sources'
import type { PlatformUsageBase } from './usage/types'

/**
 * MiniMax 用量数据源。两条腿:
 *
 * 1. **额度(自动)**:订阅 Key(`sk-cp-...`)+ `Authorization: Bearer` →
 *    `GET https://api.minimax.cn/v1/token_plan/remains` → 按模型的 5 小时/周
 *    用量与剩余(和官方 `mmx quota` 同源)。`ensureMinimaxScheduler()` 每 10 分钟自动拉。
 * 2. **逐天历史(书签)**:`_token` 是 HttpOnly,JS 读不到 → 书签在 `*.minimax.cn`
 *    同源 fetch `usage_hourly_detail`(逐小时×模型×来源)POST 到 `/api/admin/minimax/sync`,
 *    服务端聚合入库。**Cookie 始终留在浏览器**。
 *
 * 前端读库内快照,任意区间本地过滤。
 */

const K_SYNC = 'minimax_sync_key'
const K_SYNC_AT = 'minimax_sync_at'
const K_DATA = 'minimax_sync_data'
const K_ERR = 'minimax_last_error'
const K_SUBKEY = 'minimax_sub_key'
const K_QUOTA = 'minimax_quota'

/** 开放平台 API 基址(额度接口;可被 env 覆盖) */
const API_BASE = (process.env.MINIMAX_API_BASE_URL || 'https://api.minimax.cn').replace(/\/$/, '')
const REMAINS_PATH = '/v1/token_plan/remains'

/* ---------- 同步密钥(跨站书签 POST 校验) ---------- */

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

export function verifySyncKey(key: string): boolean {
  if (!key) return false
  return getDb().getMeta(K_SYNC) === key
}

export const getLastError = async () => getDb().getMeta(K_ERR) ?? ''
export const setLastError = async (e: string) => getDb().setMeta(K_ERR, e)

/* ---------- 订阅 Key(额度自动同步) ---------- */

export const getSubKey = async () => getDb().getMeta(K_SUBKEY) ?? ''
export async function setSubKey(k: string) {
  getDb().setMeta(K_SUBKEY, k.trim())
}
export function clearSubKey() {
  const db = getDb()
  db.setMeta(K_SUBKEY, '')
  db.setMeta(K_QUOTA, '')
}

/* ---------- 额度类型 ---------- */

export interface MinimaxQuotaModel {
  name: string
  intervalUsedPct: number
  intervalRemainingPct: number
  intervalResetMs?: number
  intervalStatus?: number
  weeklyUsedPct: number
  weeklyRemainingPct: number
  weeklyResetMs?: number
  weeklyStatus?: number
}

export interface MinimaxQuota {
  models: MinimaxQuotaModel[]
  creditBalance?: number
  at?: number
}

interface RemainsModel {
  model_name?: string
  end_time?: number
  current_interval_remaining_percent?: number
  current_interval_status?: number
  current_weekly_remaining_percent?: number
  current_weekly_status?: number
  weekly_end_time?: number
}
interface RemainsResp {
  base_resp?: { status_code?: number; status_msg?: string }
  model_remains?: RemainsModel[]
  credit_balance?: number
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n))

/** 拉取 M Plan 额度并落库(自动同步核心) */
export async function fetchMinimaxQuota(): Promise<MinimaxQuota> {
  const key = await getSubKey()
  if (!key) throw new Error('未配置订阅 Key')
  let res: Response
  try {
    res = await fetch(`${API_BASE}${REMAINS_PATH}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'TimeoutError' ? 'MiniMax 额度接口超时' : 'MiniMax 额度接口请求失败')
  }
  const j = (await res.json().catch(() => null)) as RemainsResp | null
  const sc = j?.base_resp?.status_code
  if (!res.ok || !j || (sc !== undefined && sc !== 0)) {
    throw new Error(j?.base_resp?.status_msg || `额度接口返回错误(HTTP ${res.status})`)
  }
  const models: MinimaxQuotaModel[] = (j.model_remains ?? []).map((m) => {
    const intervalRemainingPct = clampPct(Number(m.current_interval_remaining_percent ?? 0))
    const weeklyRemainingPct = clampPct(Number(m.current_weekly_remaining_percent ?? 0))
    return {
      name: String(m.model_name ?? '').trim() || 'M Plan',
      intervalRemainingPct,
      intervalUsedPct: 100 - intervalRemainingPct,
      intervalResetMs: typeof m.end_time === 'number' ? m.end_time : undefined,
      intervalStatus: typeof m.current_interval_status === 'number' ? m.current_interval_status : undefined,
      weeklyRemainingPct,
      weeklyUsedPct: 100 - weeklyRemainingPct,
      weeklyResetMs: typeof m.weekly_end_time === 'number' ? m.weekly_end_time : undefined,
      weeklyStatus: typeof m.current_weekly_status === 'number' ? m.current_weekly_status : undefined,
    }
  })
  const quota: MinimaxQuota = {
    models,
    creditBalance: typeof j.credit_balance === 'number' ? j.credit_balance : undefined,
    at: Date.now(),
  }
  const db = getDb()
  db.setMeta(K_QUOTA, JSON.stringify(quota))
  db.setMeta(K_ERR, '')
  invalidateAvailability()
  return quota
}

/** 读取最近一次额度快照 */
export function getMinimaxQuota(): MinimaxQuota | null {
  const raw = getDb().getMeta(K_QUOTA)
  if (!raw) return null
  try {
    const q = JSON.parse(raw) as MinimaxQuota
    return q && Array.isArray(q.models) ? q : null
  } catch {
    return null
  }
}

/* ---------- 后台自动同步调度(额度) ---------- */

const SCHEDULE_MS = 10 * 60_000

export function ensureMinimaxScheduler(): void {
  const g = globalThis as unknown as { __mmInit?: boolean; __mmTimer?: ReturnType<typeof setInterval> }
  if (g.__mmInit) return
  g.__mmInit = true

  const tick = () => {
    void (async () => {
      try {
        if (!(await getSubKey())) return
        await fetchMinimaxQuota()
      } catch (e) {
        await setLastError(e instanceof Error ? e.message : '额度同步失败')
        invalidateAvailability()
      }
    })()
  }
  tick()
  g.__mmTimer = setInterval(tick, SCHEDULE_MS)
  ;(g.__mmTimer as unknown as { unref?: () => void }).unref?.()
}

/* ---------- 逐天历史(书签推送) ---------- */

export interface MinimaxEntry {
  time_range?: string
  model?: string
  source?: string
  biz_type?: string
  input_token?: number | null
  output_token?: number | null
  cache_read_token?: number | null
  cache_create_token?: number | null
  [k: string]: unknown
}

export interface MinimaxSyncPayload {
  start?: string
  end?: string
  entries?: MinimaxEntry[]
}

export interface MinimaxStored {
  at: number
  start: string
  end: string
  rows: UsageRow[]
  records: number
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** "2026/10/06 13:00～14:00" / "2026-10-06 ..." → "2026-10-06" */
function dayOf(timeRange: string | undefined): string {
  if (!timeRange) return ''
  const head = String(timeRange).slice(0, 10).replace(/\//g, '-')
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : ''
}

/** entries → UsageRow[](按 天×模型×来源 聚合) */
export function aggregateMinimaxEntries(entries: MinimaxEntry[]): { rows: UsageRow[]; rawCount: number } {
  const map = new Map<string, { day: string; model: string; key: string; in: number; out: number; cache: number; req: number }>()
  for (const e of entries || []) {
    const day = dayOf(e.time_range)
    if (!day) continue
    const model = String(e.model ?? '').trim() || '(unknown)'
    const src = String(e.source ?? '').trim()
    const key = src && src !== '-' ? src : ''
    const inT = num(e.input_token)
    const outT = num(e.output_token)
    const cache = num(e.cache_read_token)
    if (inT === 0 && outT === 0 && cache === 0) continue
    const k = `${day}|${model}|${key}`
    const cur = map.get(k)
    if (cur) {
      cur.in += inT
      cur.out += outT
      cur.cache += cache
      cur.req += 1
    } else {
      map.set(k, { day, model, key, in: inT, out: outT, cache, req: 1 })
    }
  }
  const rows: UsageRow[] = []
  for (const v of map.values()) {
    rows.push({
      ts: `${v.day}T00:00:00Z`,
      model: v.model,
      inputTokens: v.in,
      outputTokens: v.out,
      cacheHitTokens: v.cache,
      requests: v.req,
      source: 'minimax',
      apiKey: v.key || undefined,
    })
  }
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.model.localeCompare(b.model)))
  return { rows, rawCount: entries?.length ?? 0 }
}

export function setMinimaxSyncData(payload: MinimaxSyncPayload): MinimaxStored {
  const start = String(payload.start ?? '').slice(0, 10)
  const end = String(payload.end ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('start/end 需为 YYYY-MM-DD')
  }
  if (start > end) throw new Error('start 需 ≤ end')
  const entries = Array.isArray(payload.entries) ? payload.entries : []
  if (entries.length === 0) throw new Error('entries 为空')
  const { rows, rawCount } = aggregateMinimaxEntries(entries)
  if (rows.length === 0) throw new Error('聚合后无可用记录(全部为空或非 token 行)')
  const stored: MinimaxStored = { at: Date.now(), start, end, rows, records: rawCount }
  const db = getDb()
  db.setMeta(K_DATA, JSON.stringify(stored))
  db.setMeta(K_SYNC_AT, new Date().toISOString())
  db.setMeta(K_ERR, '')
  invalidateAvailability()
  return stored
}

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

/** 清除全部(额度 + 订阅 Key + 历史 + 错误) */
export function clearMinimaxData(): void {
  const db = getDb()
  db.setMeta(K_DATA, '')
  db.setMeta(K_SYNC_AT, '')
  db.setMeta(K_ERR, '')
  db.setMeta(K_SUBKEY, '')
  db.setMeta(K_QUOTA, '')
  invalidateAvailability()
}

/* ---------- 用量接口(纯本地,不打网络) ---------- */

export interface PlatformUsageMinimax extends PlatformUsageBase {
  source: 'minimax'
  models: string[]
  apiKeys: string[]
}

/** 从本地快照读取区间内历史(零延迟) */
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
  return { source: 'minimax', rows, models, apiKeys, currency: 'CNY', granularity: 'day', start, end }
}

/** 是否有可展示内容(额度快照 或 历史);供面板可用性探测 */
export function hasMinimaxData(): boolean {
  const q = getMinimaxQuota()
  if (q && q.models.length > 0) return true
  const stored = getLastSync()
  if (!stored?.rows?.length) return false
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const maxDay = stored.rows.reduce((m, r) => (r.ts.slice(0, 10) > m ? r.ts.slice(0, 10) : m), '')
  return !!maxDay && maxDay >= cutoff
}

/** admin 状态摘要(历史快照) */
export async function getSnapshotStatus(): Promise<{ at: number; count: number; start?: string; end?: string } | null> {
  const stored = getLastSync()
  if (!stored) return null
  return { at: stored.at, count: stored.rows.length, start: stored.start, end: stored.end }
}
