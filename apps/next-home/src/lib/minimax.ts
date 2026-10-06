import crypto from 'node:crypto'
import type { UsageRow } from '@zx/shared'
import { getDb } from './db'
import { windowOf, type UsageFilter, type UsageRange } from './usage/range'
import { invalidateAvailability } from './usage-sources'
import type { PlatformUsageBase } from './usage/types'

/**
 * MiniMax 用量数据源(书签推送)。
 *
 * 关键约束:MiniMax **没有公开的用量 REST API**,控制台真实接口在 `www.minimax.cn`,
 * 鉴权用**网页登录 Cookie `_token`(HttpOnly,JS 读不到)**。因此**无法**做服务器端
 * 定时自动同步(没有可用凭证)。
 *
 * 采用「**书签一键推送**」:书签在 `*.minimax.cn` 控制台页面点 → 同源 fetch
 *   GET /backend/account/token_plan/usage_hourly_detail?start_time&end_time(≤30 天)
 * (浏览器自动带 Cookie)→ 把 `entries`(逐小时 × 模型 × 来源,含 input/output/cache 拆分)
 * POST 到本站 `/api/admin/minimax/sync` → 服务端按 (天×模型×来源) 聚合入库。
 * 前端读库内快照,任意区间本地过滤,零延迟。
 */

const K_SYNC = 'minimax_sync_key'
const K_SYNC_AT = 'minimax_sync_at'
const K_DATA = 'minimax_sync_data'
const K_ERR = 'minimax_last_error'

/** 控制台 API 基址(可被 env 覆盖,便于国际站 minimax.io) */
export const MINIMAX_BASE = (process.env.MINIMAX_BASE_URL || 'https://www.minimax.cn').replace(/\/$/, '')
export const MINIMAX_HOURLY_PATH = '/backend/account/token_plan/usage_hourly_detail'

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

/**
 * 校验跨站同步密钥(来自 minimax.cn 控制台)。
 * 书签 POST 是跨站请求,不带 zx_admin cookie,故用密钥校验;轮换后旧密钥失效。
 */
export function verifySyncKey(key: string): boolean {
  if (!key) return false
  return getDb().getMeta(K_SYNC) === key
}

export const getLastError = async () => getDb().getMeta(K_ERR) ?? ''
export const setLastError = async (e: string) => getDb().setMeta(K_ERR, e)

/* ---------- 数据类型 ---------- */

/** usage_hourly_detail 的一条 entry */
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

/* ---------- 聚合 ---------- */

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

/** entries → UsageRow[](按 天×模型×来源 聚合);返回 rows 与原始条数 */
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
    // 无 token 的行(如 tool 调用)跳过
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

function commitSnapshot(start: string, end: string, rows: UsageRow[], rawCount: number): MinimaxStored {
  const stored: MinimaxStored = { at: Date.now(), start, end, rows, records: rawCount }
  const db = getDb()
  db.setMeta(K_DATA, JSON.stringify(stored))
  db.setMeta(K_SYNC_AT, new Date().toISOString())
  db.setMeta(K_ERR, '')
  invalidateAvailability()
  return stored
}

/** 写入书签推送的用量数据(entries 来自 usage_hourly_detail) */
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
  return commitSnapshot(start, end, rows, rawCount)
}

/** 读取最近一次同步的快照 */
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

/** 清除同步数据 */
export function clearMinimaxData(): void {
  const db = getDb()
  db.setMeta(K_DATA, '')
  db.setMeta(K_SYNC_AT, '')
  db.setMeta(K_ERR, '')
  invalidateAvailability()
}

/* ---------- 用量接口(纯本地,不打网络) ---------- */

export interface PlatformUsageMinimax extends PlatformUsageBase {
  source: 'minimax'
  models: string[]
  apiKeys: string[]
}

/** 从本地快照读取区间内用量(零延迟) */
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
