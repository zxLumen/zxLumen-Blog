import crypto from 'node:crypto'
import type { UsageRow } from '@zx/shared'
import { getDb } from './db'
import { windowOf, type UsageFilter, type UsageRange } from './usage/range'
import { invalidateAvailability } from './usage-sources'
import type { PlatformUsageBase } from './usage/types'

/**
 * MiniMax 开放平台用量数据源。
 *
 * 关键约束:MiniMax **没有公开的用量 REST API**(open API 仅暴露推理),
 * 真实接口在控制台内部(`www.minimax.cn`),鉴权用**网页登录 Cookie**
 * (大概率 HttpOnly + SameSite=Lax,JS 无法直接读取)。
 *
 * 因此本数据源走「**书签推送**」模型:书签在 minimax.cn 页面上点 → 同源
 * fetch `/v1/api/openplatform/charge/charge_record/query` 分页拉取 →
 * POST 到本站 `/api/admin/minimax/sync`。Cookie **不上服务器**,
 * 刷新要再点书签。接口响应每条 record 含真实金额与 token 拆分,
 * 服务端按 (天 × 模型 × API Key) 聚合成 UsageRow 入库,
 * 任意区间**本地过滤**展示,零延迟、零外部依赖。
 */

const K_SYNC = 'minimax_sync_key'
const K_SYNC_AT = 'minimax_sync_at'
const K_DATA = 'minimax_sync_data'
const K_ERR = 'minimax_last_error'

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

/* ---------- 存储 ---------- */

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
  /** token_plan/usage 配额原始响应(结构未知,先原样存,首跑后按真实字段渲染) */
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
    const cash = r.consume_cash_after_voucher != null && Number(r.consume_cash_after_voucher) >= 0
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

/** 写入同步数据(由 sync 路由调用);失败抛错 */
export function setMinimaxSyncData(payload: MinimaxSyncPayload): MinimaxStored {
  const start = String(payload.start ?? '').slice(0, 10)
  const end = String(payload.end ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('start/end 需为 YYYY-MM-DD')
  }
  if (start > end) throw new Error('start 需 ≤ end')
  const recs = Array.isArray(payload.records) ? payload.records : []
  if (recs.length === 0) throw new Error('records 为空')
  const { rows, rawCount } = aggregateMinimaxRecords(recs)
  if (rows.length === 0) throw new Error('聚合后无可用记录(全部为空)')
  const stored: MinimaxStored = {
    at: Date.now(),
    start,
    end,
    rows,
    quota: payload.quota ?? null,
    records: rawCount,
  }
  const db = getDb()
  db.setMeta(K_DATA, JSON.stringify(stored))
  db.setMeta(K_SYNC_AT, new Date().toISOString())
  db.setMeta(K_ERR, '')
  invalidateAvailability()
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

/** 清除同步数据(清除按钮) */
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
