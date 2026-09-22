import crypto from 'node:crypto'
import zlib from 'node:zlib'
import type { UsageRow } from '@zx/shared'
import { getActiveDb } from './env'
import { getDb, getTestDb } from './db'

const K_TOKEN = 'deepseek_user_token'
const K_SYNC = 'deepseek_sync_key'
const K_SYNC_AT = 'deepseek_sync_at'
const K_ERR = 'deepseek_last_error'
const K_AVAIL = 'deepseek_last_data'

const BASE = 'https://platform.deepseek.com/api/v0/usage'
const TZ = 28800 // 北京时间 UTC+8

/* ---------- meta 存取 ---------- */

export const getToken = async () => (await getActiveDb()).getMeta(K_TOKEN) || ''
export const setToken = async (t: string) => (await getActiveDb()).setMeta(K_TOKEN, t)
export const getSyncAt = async () => (await getActiveDb()).getMeta(K_SYNC_AT)
export const setSyncAt = async (v: string) => (await getActiveDb()).setMeta(K_SYNC_AT, v)
export const getLastError = async () => (await getActiveDb()).getMeta(K_ERR)
export const setLastError = async (e: string) => (await getActiveDb()).setMeta(K_ERR, e)
export const getLastData = async () => (await getActiveDb()).getMeta(K_AVAIL)

export async function getSyncKey(): Promise<string> {
  const db = await getActiveDb()
  let k = db.getMeta(K_SYNC)
  if (!k) {
    k = crypto.randomBytes(16).toString('hex')
    db.setMeta(K_SYNC, k)
  }
  return k
}

export async function rotateSyncKey(): Promise<string> {
  const k = crypto.randomBytes(16).toString('hex')
  ;(await getActiveDb()).setMeta(K_SYNC, k)
  return k
}

/**
 * 依据同步密钥判定写入哪个库(测试 / 线上)。
 *
 * 令牌同步是**跨站请求**(来自 platform.deepseek.com),浏览器不会携带 SameSite=Lax
 * 的 `zx_admin`/`zx_env` cookie,服务端无法靠 cookie 判断当前模式。因此改用「密钥来自
 * 哪个库」来决定:密钥匹配测试库 → 写测试库;否则匹配线上库 → 写线上库。均不匹配返回 null。
 */
export function resolveSyncTarget(key: string): 'test' | 'live' | null {
  if (!key) return null
  if (getTestDb().getMeta(K_SYNC) === key) return 'test'
  if (getDb().getMeta(K_SYNC) === key) return 'live'
  return null
}

/** 把令牌写入指定库(绕过 cookie 的模式判定,用于跨站同步) */
export function setTokenIn(target: 'test' | 'live', token: string): void {
  const db = target === 'test' ? getTestDb() : getDb()
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

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

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
    const e = new Error('INVALID_TOKEN')
    ;(e as { code?: string }).code = 'INVALID_TOKEN'
    throw e
  }
  if (!res.ok) throw new Error(`平台 HTTP ${res.status}`)
  if (code !== undefined && code !== 0) {
    const msg = data?.data?.biz_msg || data?.msg || `biz_code=${code}`
    throw new Error(`平台错误 ${msg || '未知'}${msg.includes('INVALID_PARAM') ? '(请求参数不被接受,平台接口可能已改版)' : ''}`)
  }
  return data?.data?.biz_data ?? data
}

type Month = { year: number; month: number }

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

/** 简易 CSV 解析(处理引号/转义/CRLF/UTF-8 BOM) */
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

/** 拉取单月导出 ZIP,从 amount CSV 还原 (天 × 模型 × API Key) 的 tokens/请求/费用(费用=price×amount) */
async function fetchExport(m: Month, token: string): Promise<{ rows: UsageRow[]; apiKeys: string[] }> {
  const res = await fetch(`${BASE}/export?month=${m.month}&year=${m.year}`, {
    headers: authHeaders(token),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (res.status === 401 || res.status === 403) {
    const e = new Error('INVALID_TOKEN')
    ;(e as { code?: string }).code = 'INVALID_TOKEN'
    throw e
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
const utcDay = (y: number, m: number, d: number) => {
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}
/** 某月的天数(按 UTC 日历,仅用于边界计算) */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** 北京日历日 YYYY-MM-DD(相对今天偏移 offsetDays);用于区间边界(平台账单按北京时间对齐) */
function bjDay(offsetDays = 0): string {
  const ms = Math.floor((Date.now() + TZ * 1000) / 86400000) * 86400000 + offsetDays * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

export type UsageRange = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastmonth' | 'custom'

export interface UsageFilter {
  start?: string
  end?: string
}

export interface PlatformUsage {
  rows: UsageRow[]
  /** 全量模型清单(含零用量),用于前端置灰显示 */
  models: string[]
  /** 出现过的 API Key 名称清单(按 key 维度聚合) */
  apiKeys: string[]
  currency: string
  start: string
  end: string
  /** 今天/昨天为 hour(分时),其余为 day */
  granularity?: 'hour' | 'day'
}

/** 解析按月 amount 接口的模型清单(含零用量模型,来自 total) */
function periodModels(biz: unknown): string[] {
  const b = biz as { total?: Array<{ model?: string }> } | null
  return (b?.total ?? []).map((t) => t.model ?? '').filter(Boolean)
}

/** 北京整点标签,如 2026-09-22T10:00:00Z(约定:日期=北京日,小时=北京时,与 opencode 一致) */
const bjHourLabel = (sec: number) => `${new Date(sec * 1000 + TZ * 1000).toISOString().slice(0, 13)}:00:00Z`

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

/**
 * 当天分时数据:by_api_key/amount(+cost) 按北京时间窗口拉取,bucket=3600(小时),
 * 与平台 usage 页「今天/昨天分时柱状图」同一数据源。每桶含 (小时 × 模型 × API Key)。
 */
async function fetchDayHourly(day: string): Promise<{ rows: UsageRow[]; models: string[]; apiKeys: string[] }> {
  const token = await getToken()
  if (!token) throw new Error('未配置 DeepSeek 令牌')

  const g = globalThis as unknown as {
    __dsHourCache?: Map<string, { at: number; data: { rows: UsageRow[]; models: string[]; apiKeys: string[] } }>
  }
  g.__dsHourCache ??= new Map()
  const hit = g.__dsHourCache.get(day)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data

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
  g.__dsHourCache.set(day, { at: Date.now(), data })
  return data
}

const CACHE_TTL = 5 * 60 * 1000

/** 拉取指定年/月的一整月数据:amount JSON 取全量模型清单(含零用量),export ZIP 取按 (天×模型×Key) 的用量/费用 */
async function fetchPeriod(m: Month): Promise<{ rows: UsageRow[]; models: string[]; apiKeys: string[]; currency: string }> {
  const token = await getToken()
  if (!token) throw new Error('未配置 DeepSeek 令牌')

  const g = globalThis as unknown as {
    __dsCache?: Map<string, { at: number; data: { rows: UsageRow[]; models: string[]; apiKeys: string[]; currency: string } }>
  }
  g.__dsCache ??= new Map()
  const ck = key(m)
  const hit = g.__dsCache.get(ck)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data

  const [amountBiz, exp] = await Promise.all([
    fetchJson('amount', token, `month=${m.month}&year=${m.year}`),
    fetchExport(m, token),
  ])
  const models = periodModels(amountBiz)
  const data = { rows: exp.rows, models, apiKeys: exp.apiKeys, currency: 'CNY' }
  g.__dsCache.set(ck, { at: Date.now(), data })
  return data
}

/** 计算指定 range 的闭区间日期窗口(北京日,YYYY-MM-DD) */
export function windowOf(range: UsageRange, filter?: UsageFilter): { start: string; end: string } {
  const today = bjDay(0)
  const lastMonthBounds = (): { start: string; end: string } => {
    const y = Number(today.slice(0, 4))
    const m = Number(today.slice(5, 7))
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
    return { start: utcDay(prev.y, prev.m, 1), end: utcDay(prev.y, prev.m, daysIn(prev.y, prev.m)) }
  }
  switch (range) {
    case 'today':
      return { start: today, end: today }
    case 'yesterday':
      return { start: bjDay(-1), end: bjDay(-1) }
    case '7d':
      return { start: bjDay(-6), end: today }
    case '30d':
      return { start: bjDay(-29), end: today }
    case 'month':
      return { start: today.slice(0, 7) + '-01', end: today }
    case 'lastmonth':
      return lastMonthBounds()
    case 'custom': {
      const start = filter?.start || today
      const end = filter?.end || today
      return { start: start <= end ? start : end, end: start <= end ? end : start }
    }
  }
}

/** start 到 end 之间需要拉取的月(升序,上限 12 个月) */
function monthsIn(start: string, end: string): Month[] {
  const out: Month[] = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const endY = Number(end.slice(0, 4))
  const endM = Number(end.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    if (out.length >= 12) break
    out.push({ year: y, month: m })
    if (m === 12) {
      y += 1
      m = 1
    } else {
      m += 1
    }
  }
  if (out.length === 0) out.push({ year: endY, month: endM })
  return out
}

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
      (await getActiveDb()).setMeta(K_AVAIL, JSON.stringify({ at: Date.now(), count: hour.rows.length }))
    await saveLastRows(range, data)
    return data
  }

  const months = monthsIn(start, end)

  const periods = await Promise.all(months.map((m) => fetchPeriod(m)))
  const currency = periods.find((p) => p.currency)?.currency ?? 'CNY'
  const models = Array.from(new Set(periods.flatMap((p) => p.models)))
  const apiKeys = Array.from(new Set(periods.flatMap((p) => p.apiKeys)))

  // 合并过滤:区间内 + 剔除全零行(保留全量模型清单与 Key 清单供前端筛选/置灰)
  const raw = periods.flatMap((p) => p.rows)
  const merged = new Map<string, UsageRow>()
  for (const r of raw) {
    const day = r.ts.slice(0, 10)
    if (day < start || day > end) continue
    const k = `${day}|${r.model}|${r.apiKey ?? ''}`
    const ex = merged.get(k)
    if (ex) {
      ex.inputTokens += r.inputTokens
      ex.outputTokens += r.outputTokens
      ex.cacheHitTokens += r.cacheHitTokens
      ex.requests = (ex.requests ?? 0) + (r.requests ?? 0)
      ex.cost = (ex.cost ?? 0) + (r.cost ?? 0)
    } else {
      merged.set(k, { ...r })
    }
  }
  const rows = [...merged.values()].filter(
    (r) => r.inputTokens + r.outputTokens > 0 || (r.cost ?? 0) > 0 || (r.requests ?? 0) > 0,
  )

  const data: PlatformUsage = { rows, models, apiKeys, currency, start, end }
  await setLastError('')
  if (rows.length) (await getActiveDb()).setMeta(K_AVAIL, JSON.stringify({ at: Date.now(), count: rows.length }))
  await saveLastRows(range, data)
  return data
}

/* ---------- 上次成功数据回退 ---------- */

const kRows = (range: UsageRange) => `deepseek_last_rows_${range}`
const MAX_ROWS = 5000

/** 存储指定 range 最近一次拉取成功的 rows(持久化,用于令牌失效/网络失败时回退) */
export async function saveLastRows(range: UsageRange, d: PlatformUsage) {
  const rows = d.rows.length > MAX_ROWS ? d.rows.slice(0, MAX_ROWS) : d.rows
  ;(await getActiveDb()).setMeta(
    kRows(range),
    JSON.stringify({
      at: Date.now(),
      range,
      currency: d.currency,
      models: d.models,
      apiKeys: d.apiKeys,
      granularity: d.granularity,
      rows,
    }),
  )
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
  const raw = (await getActiveDb()).getMeta(kRows(range))
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as {
      at?: number
      range?: UsageRange
      currency?: string
      models?: string[]
      apiKeys?: string[]
      granularity?: 'hour' | 'day'
      rows?: UsageRow[]
    }
    if (d.range !== range || !Array.isArray(d.rows) || d.rows.length === 0) return null
    return {
      at: d.at ?? 0,
      currency: d.currency,
      models: d.models,
      apiKeys: d.apiKeys,
      granularity: d.granularity,
      rows: d.rows,
    }
  } catch {
    return null
  }
}