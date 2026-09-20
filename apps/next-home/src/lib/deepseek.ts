import crypto from 'node:crypto'
import type { UsageRow } from '@zx/shared'
import { getDb } from './db'

const K_TOKEN = 'deepseek_user_token'
const K_SYNC = 'deepseek_sync_key'
const K_SYNC_AT = 'deepseek_sync_at'
const K_ERR = 'deepseek_last_error'
const K_AVAIL = 'deepseek_last_data'

const BASE = 'https://platform.deepseek.com/api/v0/usage/by_api_key'
const TZ = 28800 // 北京时间 UTC+8

/* ---------- meta 存取 ---------- */

export const getToken = () => getDb().getMeta(K_TOKEN) || ''
export const setToken = (t: string) => getDb().setMeta(K_TOKEN, t)
export const getSyncAt = () => getDb().getMeta(K_SYNC_AT)
export const setSyncAt = (v: string) => getDb().setMeta(K_SYNC_AT, v)
export const getLastError = () => getDb().getMeta(K_ERR)
export const setLastError = (e: string) => getDb().setMeta(K_ERR, e)
export const getLastData = () => getDb().getMeta(K_AVAIL)

export function getSyncKey(): string {
  const db = getDb()
  let k = db.getMeta(K_SYNC)
  if (!k) {
    k = crypto.randomBytes(16).toString('hex')
    db.setMeta(K_SYNC, k)
  }
  return k
}

export function rotateSyncKey(): string {
  const k = crypto.randomBytes(16).toString('hex')
  getDb().setMeta(K_SYNC, k)
  return k
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

/* ---------- 平台用量拉取 ---------- */

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

interface RawBucket {
  day: string
  model: string
  apiKey: string
  requests: number
  cacheHit: number
  cacheMiss: number
  output: number
  cost: number
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

async function fetchEndpoint(path: string, token: string, qs: string): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}?${qs}`, {
    headers: authHeaders(token),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  const text = await res.text()
  let data: { code?: number; msg?: string; data?: { biz_code?: number; biz_data?: unknown } } | null = null
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
  if (code !== undefined && code !== 0) throw new Error(`平台错误 ${code}: ${data?.msg ?? data?.data?.biz_code ?? ''}`)
  return data?.data?.biz_data ?? data
}

function parseAmount(biz: unknown): RawBucket[] {
  const out: RawBucket[] = []
  const b = biz as { series?: unknown[]; days?: unknown[] } | null
  if (Array.isArray(b?.series)) {
    for (const s of b.series as Array<{ model?: string; api_key?: string; apiKey?: string; buckets?: unknown[] }>) {
      for (const bk of s.buckets ?? []) {
        const bkt = bk as { time?: string; usage?: Record<string, unknown> }
        const u = bkt.usage ?? {}
        out.push({
          day: String(bkt.time ?? '').slice(0, 10),
          model: s.model ?? '',
          apiKey: s.api_key ?? s.apiKey ?? '',
          requests: num(u.REQUEST ?? u.request),
          cacheHit: num(u.PROMPT_CACHE_HIT_TOKEN),
          cacheMiss: num(u.PROMPT_CACHE_MISS_TOKEN),
          output: num(u.RESPONSE_TOKEN),
          cost: 0,
        })
      }
    }
    return out
  }
  // 旧结构:days[].data[]
  for (const d of (b?.days as Array<{ date?: string; data?: unknown[] }>) ?? []) {
    for (const e of d.data ?? []) {
      const en = e as { model?: string; api_key?: string; usage?: unknown }
      const usage = en.usage
      const map = Array.isArray(usage)
        ? Object.fromEntries((usage as Array<{ type: string; amount: number }>).map((x) => [x.type, x.amount]))
        : ((usage as Record<string, unknown>) ?? {})
      out.push({
        day: String(d.date ?? '').slice(0, 10),
        model: en.model ?? '',
        apiKey: en.api_key ?? '',
        requests: num(map.REQUEST),
        cacheHit: num(map.PROMPT_CACHE_HIT_TOKEN),
        cacheMiss: num(map.PROMPT_CACHE_MISS_TOKEN),
        output: num(map.RESPONSE_TOKEN),
        cost: 0,
      })
    }
  }
  return out
}

const costKey = (day: string, model: string, apiKey: string) => `${day}|${model}|${apiKey}`

function parseCost(biz: unknown): { costs: Map<string, number>; currency: string } {
  const costs = new Map<string, number>()
  let currency = 'CNY'
  const b = biz as { data?: unknown[]; currency?: string; days?: unknown[] } | null
  if (Array.isArray(b?.data)) {
    for (const group of b.data as Array<{ currency?: string; series?: unknown[] }>) {
      if (group.currency) currency = group.currency
      for (const s of group.series ?? []) {
        const se = s as { model?: string; api_key?: string; apiKey?: string; buckets?: unknown[] }
        for (const bk of se.buckets ?? []) {
          const bkt = bk as { time?: string; cost?: unknown }
          costs.set(costKey(String(bkt.time ?? '').slice(0, 10), se.model ?? '', se.api_key ?? se.apiKey ?? ''), num(bkt.cost))
        }
      }
    }
    return { costs, currency }
  }
  if (b?.currency) currency = b.currency
  for (const d of (b?.days as Array<{ date?: string; data?: unknown[] }>) ?? []) {
    for (const e of d.data ?? []) {
      const en = e as { model?: string; api_key?: string; usage?: unknown }
      let c = 0
      if (Array.isArray(en.usage)) for (const u of en.usage as Array<{ amount?: unknown }>) c += num(u.amount)
      costs.set(costKey(String(d.date ?? '').slice(0, 10), en.model ?? '', en.api_key ?? ''), c)
    }
  }
  return { costs, currency }
}

export type UsageRange = '24h' | '7d' | '30d' | '90d'

const RANGE_SEC: Record<UsageRange, number> = {
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  '90d': 90 * 86400,
}

export interface PlatformUsage {
  rows: UsageRow[]
  currency: string
  start: number
  end: number
}

const g = globalThis as unknown as { __dsCache?: Map<string, { at: number; data: PlatformUsage }> }
const CACHE_TTL = 5 * 60 * 1000

export async function fetchUsage(range: UsageRange): Promise<PlatformUsage> {
  const token = getToken()
  if (!token) throw new Error('未配置 DeepSeek 令牌')

  g.__dsCache ??= new Map()
  const cacheKey = `${range}`
  const hit = g.__dsCache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data

  const end = Math.floor(Date.now() / 1000)
  const start = end - RANGE_SEC[range]
  const qs = `start=${start}&end=${end}&tz=${TZ}`

  const [amountBiz, costBiz] = await Promise.all([
    fetchEndpoint('amount', token, qs),
    fetchEndpoint('cost', token, qs),
  ])

  const amount = parseAmount(amountBiz)
  const { costs, currency } = parseCost(costBiz)

  // 合并:以 amount 为主,补齐 cost(也纳入仅有 cost 的桶)
  const map = new Map<string, RawBucket>()
  for (const a of amount) map.set(costKey(a.day, a.model, a.apiKey), { ...a })
  for (const [k, c] of costs) {
    const ex = map.get(k)
    if (ex) ex.cost = c
    else {
      const [day, model, apiKey] = k.split('|')
      map.set(k, { day, model, apiKey, requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: c })
    }
  }

  const rows: UsageRow[] = [...map.values()]
    .filter((b) => b.day)
    .map((b) => ({
      ts: `${b.day}T00:00:00Z`,
      model: b.model || 'unknown',
      inputTokens: b.cacheHit + b.cacheMiss,
      outputTokens: b.output,
      cacheHitTokens: b.cacheHit,
      apiKey: b.apiKey,
      requests: b.requests,
      cost: b.cost,
      source: 'deepseek',
    }))

  const data: PlatformUsage = { rows, currency, start, end }
  g.__dsCache.set(cacheKey, { at: Date.now(), data })
  setLastError('')
  getDb().setMeta(K_AVAIL, JSON.stringify({ at: Date.now(), count: rows.length }))
  return data
}
