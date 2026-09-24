import crypto from 'node:crypto'
import zlib from 'node:zlib'
import type { UsageRow } from '@zx/shared'
import { getDb } from './db'
import {
  TZ,
  bjHourLabel,
  monthsIn,
  windowOf,
  type Month,
  type UsageFilter,
  type UsageRange,
} from './usage/range'
import { num, parseCsv } from './usage/csv'
import { makeTtlCache } from './usage/cache'
import { aggregateRows, isNonZeroRow } from './usage/aggregate'
import { usageError } from './usage/errors'
import { readSnapshot, writeSnapshot } from './usage/snapshot'
import type { PlatformUsageBase } from './usage/types'

const K_TOKEN = 'deepseek_user_token'
const K_SYNC = 'deepseek_sync_key'
const K_SYNC_AT = 'deepseek_sync_at'
const K_ERR = 'deepseek_last_error'
const K_AVAIL = 'deepseek_last_data'

const BASE = 'https://platform.deepseek.com/api/v0/usage'

/* ---------- meta 存取 ---------- */

export const getToken = async () => getDb().getMeta(K_TOKEN) || ''
export const setToken = async (t: string) => getDb().setMeta(K_TOKEN, t)
export const getSyncAt = async () => getDb().getMeta(K_SYNC_AT)
export const setSyncAt = async (v: string) => getDb().setMeta(K_SYNC_AT, v)
export const getLastError = async () => getDb().getMeta(K_ERR)
export const setLastError = async (e: string) => getDb().setMeta(K_ERR, e)
export const getLastData = async () => getDb().getMeta(K_AVAIL)

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
  ;getDb().setMeta(K_SYNC, k)
  return k
}

/**
 * 校验跨站同步密钥(来自 platform.deepseek.com)。
 *
 * 令牌同步是**跨站请求**,浏览器不会携带 SameSite=Lax 的 `zx_admin` cookie,
 * 服务端无法靠 cookie 判断身份,因此用「密钥是否匹配库中已存的同步密钥」来校验。
 * 匹配返回 true,否则 false。
 */
export function verifySyncKey(key: string): boolean {
  if (!key) return false
  return getDb().getMeta(K_SYNC) === key
}

/** 把令牌写入库(跨站同步专用) */
export function setSyncedToken(token: string): void {
  const db = getDb()
  db.setMeta(K_TOKEN, token)
  db.setMeta(K_SYNC_AT, new Date().toISOString())
  db.setMeta(K_ERR, '')
}

/** 解析 JWT 过期时间(ms);失败返回 null */
export function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
    return payload.exp ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/* ---------- 平台用量拉取(按月 JSON 接口) ---------- */

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Origin: 'https://platform.deepseek.com',
    Referer: 'https://platform.deepseek.com/usage',
  }
}

async function fetchJson(path: string, token: string, qs: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}?${qs}`, {
    headers: authHeaders(token),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  const text = await res.text()
  let data: { code?: number; msg?: string; data?: { biz_code?: number; biz_msg?: string; biz_data?: unknown } } | null = null
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('平台返回非 JSON')
  }
  const code = data?.data?.biz_code ?? data?.code
  if (res.status === 401 || res.status === 403 || code === 40002 || code === 40003) {
    throw usageError('INVALID_TOKEN', 'INVALID_TOKEN')
  }
  if (!res.ok) throw new Error(`平台 HTTP ${res.status}`)
  if (code !== undefined && code !== 0) {
    const msg = data?.data?.biz_msg || data?.msg || `biz_code=${code}`
    throw new Error(`平台错误 ${msg || '未知'}${msg.includes('INVALID_PARAM') ? '(请求参数不被接受,平台接口可能已改版)' : ''}`)
  }
  return data?.data?.biz_data ?? data
}

/* ---------- ZIP / CSV(平台 export 接口返回) ---------- */

const MAX_EXPORT_LINES = 20000

/** 解析 ZIP(按中央目录,兼容 data descriptor 流式条目);return [{name, data}] */
function unzipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  let eocd = -1
  const min = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('导出 ZIP 缺少目录')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out: Array<{ name: string; data: Buffer }> = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const comp = buf.subarray(dataStart, dataStart + compSize)
    let data: Buffer
    if (method === 8) data = zlib.inflateRawSync(comp)
    else if (method === 0) data = Buffer.from(comp)
    else throw new Error(`导出 ZIP 压缩方式不支持:${method}`)
    out.push({ name, data })
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** 拉取单月导出 ZIP,从 amount CSV 还原 (天 × 模型 × API Key) 的 tokens/请求/费用(费用=price×amount) */
async function fetchExport(m: Month, token: string): Promise<{ rows: UsageRow[]; apiKeys: string[] }> {
  const res = await fetch(`${BASE}/export?month=${m.month}&year=${m.year}`, {
    headers: authHeaders(token),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (res.status === 401 || res.status === 403) {
    throw usageError('INVALID_TOKEN', 'INVALID_TOKEN')
  }
  if (!res.ok) throw new Error(`平台导出 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('平台导出非 ZIP')
  const entries = unzipEntries(buf)
  const amountCsv = entries.find((e) => /^amount-\d{4}-\d+\.csv$/.test(e.name))
  if (!amountCsv) return { rows: [], apiKeys: [] }

  const rows = new Map<string, UsageRow>()
  const apiKeys = new Set<string>()
  const lines = parseCsv(amountCsv.data.toString('utf8'))
  // 表头: user_id, utc_date, model, api_key_name, api_key, type, price, amount
  for (const line of lines.slice(1)) {
    if (rows.size >= MAX_EXPORT_LINES) break
    const [, date, model, apiKeyName, , type, price, amount] = line
    const day = String(date ?? '').slice(0, 10)
    if (!day || !model) continue
    const apiKey = String(apiKeyName ?? '')
    apiKeys.add(apiKey)
    const k = `${day}|${model}|${apiKey}`
    const ex = rows.get(k)
    const row =
      ex ??
      ({
        ts: `${day}T00:00:00Z`,
        model,
        apiKey,
        inputTokens: 0,
        outputTokens: 0,
        cacheHitTokens: 0,
        requests: 0,
        cost: 0,
        source: 'deepseek',
      } as UsageRow)
    const amt = num(amount)
    switch (String(type)) {
      case 'request_count':
        row.requests = (row.requests ?? 0) + amt
        break
      case 'input_cache_hit_tokens':
        row.cacheHitTokens += amt
        row.inputTokens += amt
        break
      case 'input_cache_miss_tokens':
        row.inputTokens += amt
        break
      case 'output_tokens':
        row.outputTokens += amt
        break
    }
    const priceV = Number(price)
    if (Number.isFinite(priceV) && priceV > 0) row.cost = (row.cost ?? 0) + priceV * amt
    rows.set(k, row)
  }
  return { rows: [...rows.values()], apiKeys: [...apiKeys].filter(Boolean) }
}

const key = (m: Month) => `m:${m.year}-${String(m.month).padStart(2, '0')}`

export type { UsageRange, UsageFilter }

export interface PlatformUsage extends PlatformUsageBase {
  /** 出现过的 API Key 名称清单(按 key 维度聚合) */
  apiKeys: string[]
}

/** 解析按月 amount 接口的模型清单(含零用量模型,来自 total) */
function periodModels(biz: unknown): string[] {
  const b = biz as { total?: Array<{ model?: string }> } | null
  return (b?.total ?? []).map((t) => t.model ?? '').filter(Boolean)
}

interface HourBucketTs {
  time?: number
  usage?: Record<string, unknown>
  cost?: string
}
interface HourSeries {
  api_key?: { name?: string }
  model?: string
  buckets?: HourBucketTs[]
}
interface HourBiz {
  models?: string[]
  series?: HourSeries[]
  /** cost 接口把 series 包在 data[0].series(amount 接口则在顶层 series) */
  data?: Array<{ currency?: string; series?: HourSeries[] }>
}

/** 取 cost 接口的分时 series:优先 data[0].series,回退顶层 series(防平台结构变化) */
const costSeries = (biz: HourBiz): HourSeries[] => biz.data?.[0]?.series ?? biz.series ?? []

type HourData = { rows: UsageRow[]; models: string[]; apiKeys: string[] }
const hourCache = makeTtlCache<HourData>('__dsHourCache')

/**
 * 当天分时数据:by_api_key/amount(+cost) 按北京时间窗口拉取,bucket=3600(小时),
 * 与平台 usage 页「今天/昨天分时柱状图」同一数据源。每桶含 (小时 × 模型 × API Key)。
 */
async function fetchDayHourly(day: string): Promise<HourData> {
  const token = await getToken()
  if (!token) throw new Error('未配置 DeepSeek 令牌')

  const hit = hourCache.get(day)
  if (hit) return hit

  const startSec = Math.floor(Date.parse(`${day}T00:00:00+08:00`) / 1000)
  const endSec = startSec + 86400
  const qs = `start=${startSec}&end=${endSec}&tz=${TZ}`
  const [amountBiz, costBiz] = await Promise.all([
    fetchJson('by_api_key/amount', token, qs),
    fetchJson('by_api_key/cost', token, qs),
  ])
  const amt = amountBiz as HourBiz
  const costMap = new Map<string, number>()
  for (const s of costSeries(costBiz as HourBiz)) {
    for (const b of s.buckets ?? []) {
      if (b.time == null) continue
      costMap.set(`${b.time}|${s.model ?? ''}`, num(b.cost))
    }
  }

  const merged = new Map<string, UsageRow>()
  const apiKeys = new Set<string>()
  for (const s of amt.series ?? []) {
    const model = s.model ?? ''
    const apiKey = s.api_key?.name ?? ''
    if (apiKey) apiKeys.add(apiKey)
    for (const b of s.buckets ?? []) {
      if (b.time == null) continue
      const u = b.usage ?? {}
      const inT = num(u.PROMPT_CACHE_MISS_TOKEN) + num(u.PROMPT_CACHE_HIT_TOKEN)
      const outT = num(u.RESPONSE_TOKEN)
      const req = num(u.REQUEST)
      if (inT + outT + req === 0) continue
      const ts = bjHourLabel(b.time)
      const k = `${ts}|${model}|${apiKey}`
      const ex = merged.get(k)
      const cost = costMap.get(`${b.time}|${model}`) ?? 0
      if (ex) {
        ex.inputTokens += inT
        ex.outputTokens += outT
        ex.cacheHitTokens += num(u.PROMPT_CACHE_HIT_TOKEN)
        ex.requests = (ex.requests ?? 0) + req
        ex.cost = (ex.cost ?? 0) + cost
      } else {
        merged.set(k, {
          ts,
          model,
          apiKey,
          inputTokens: inT,
          outputTokens: outT,
          cacheHitTokens: num(u.PROMPT_CACHE_HIT_TOKEN),
          requests: req,
          cost,
          source: 'deepseek',
        } as UsageRow)
      }
    }
  }

  const data = {
    rows: [...merged.values()],
    models: (amt.models ?? []).filter(Boolean),
    apiKeys: [...apiKeys].filter(Boolean),
  }
  hourCache.set(day, data)
  return data
}

type PeriodData = { rows: UsageRow[]; models: string[]; apiKeys: string[]; currency: string }
const periodCache = makeTtlCache<PeriodData>('__dsCache')

/** 拉取指定年/月的一整月数据:amount JSON 取全量模型清单(含零用量),export ZIP 取按 (天×模型×Key) 的用量/费用 */
async function fetchPeriod(m: Month): Promise<PeriodData> {
  const token = await getToken()
  if (!token) throw new Error('未配置 DeepSeek 令牌')

  const ck = key(m)
  const hit = periodCache.get(ck)
  if (hit) return hit

  const [amountBiz, exp] = await Promise.all([
    fetchJson('amount', token, `month=${m.month}&year=${m.year}`),
    fetchExport(m, token),
  ])
  const models = periodModels(amountBiz)
  const data = { rows: exp.rows, models, apiKeys: exp.apiKeys, currency: 'CNY' }
  periodCache.set(ck, data)
  return data
}

export { windowOf }

export async function fetchUsage(range: UsageRange, filter?: UsageFilter): Promise<PlatformUsage> {
  const token = await getToken()
  if (!token) throw new Error('未配置 DeepSeek 令牌')

  const { start, end } = windowOf(range, filter)

  // 今天/昨天:平台支持小时级分时(by_api_key/amount,c bucket=3600),与 opencode 模板一致
  if (range === 'today' || range === 'yesterday') {
    const hour = await fetchDayHourly(range === 'today' ? start : end)
    const data: PlatformUsage = {
      rows: hour.rows,
      models: hour.models,
      apiKeys: hour.apiKeys,
      currency: 'CNY',
      start,
      end,
      granularity: 'hour',
    }
    await setLastError('')
    if (hour.rows.length)
      getDb().setMeta(K_AVAIL, JSON.stringify({ at: Date.now(), count: hour.rows.length }))
    await saveLastRows(range, data)
    return data
  }

  const months = monthsIn(start, end)

  const periods = await Promise.all(months.map((m) => fetchPeriod(m)))
  const currency = periods.find((p) => p.currency)?.currency ?? 'CNY'
  const models = Array.from(new Set(periods.flatMap((p) => p.models)))
  const apiKeys = Array.from(new Set(periods.flatMap((p) => p.apiKeys)))

  // 合并过滤:区间内 + 剔除全零行(保留全量模型清单与 Key 清单供前端筛选/置灰)
  const raw = periods.flatMap((p) => p.rows).filter((r) => {
    const day = r.ts.slice(0, 10)
    return day >= start && day <= end
  })
  const rows = aggregateRows(raw, (r) => `${r.ts.slice(0, 10)}|${r.model}|${r.apiKey ?? ''}`).filter(
    isNonZeroRow,
  )

  const data: PlatformUsage = { rows, models, apiKeys, currency, start, end }
  await setLastError('')
  if (rows.length) getDb().setMeta(K_AVAIL, JSON.stringify({ at: Date.now(), count: rows.length }))
  await saveLastRows(range, data)
  return data
}

/* ---------- 上次成功数据回退 ---------- */

const kRows = (range: UsageRange) => `deepseek_last_rows_${range}`
const MAX_ROWS = 5000

/** 存储指定 range 最近一次拉取成功的 rows(持久化,用于令牌失效/网络失败时回退) */
export async function saveLastRows(range: UsageRange, d: PlatformUsage) {
  const rows = d.rows.length > MAX_ROWS ? d.rows.slice(0, MAX_ROWS) : d.rows
  writeSnapshot(kRows(range), {
    at: Date.now(),
    range,
    currency: d.currency,
    models: d.models,
    apiKeys: d.apiKeys,
    granularity: d.granularity,
    rows,
  })
}

/** 读取同 range 的上次成功数据;无或数据结构异常返回 null */
export async function getLastRows(
  range: UsageRange,
): Promise<{
  at: number
  currency?: string
  models?: string[]
  apiKeys?: string[]
  granularity?: 'hour' | 'day'
  rows: UsageRow[]
} | null> {
  const d = readSnapshot<{
    at?: number
    range?: UsageRange
    currency?: string
    models?: string[]
    apiKeys?: string[]
    granularity?: 'hour' | 'day'
    rows?: UsageRow[]
  }>(kRows(range))
  if (!d || d.range !== range || !Array.isArray(d.rows) || d.rows.length === 0) return null
  return {
    at: d.at ?? 0,
    currency: d.currency,
    models: d.models,
    apiKeys: d.apiKeys,
    granularity: d.granularity,
    rows: d.rows,
  }
}
