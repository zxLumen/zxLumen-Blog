import type { UsageRow } from '@zx/shared'
import { getDb } from './db'
import { windowOf, type UsageRange } from './usage/range'
import { makeTtlCache } from './usage/cache'
import { usageError } from './usage/errors'
import type { PlatformUsageBase } from './usage/types'

/**
 * 智谱(BigModel / Z.ai)用量数据源。
 *
 * 与 DeepSeek / OpenCode 不同,智谱**没有**逐条/逐日的用量或费用导出 API,
 * 公开监控接口只有:
 *   - GET {origin}/api/monitor/usage/quota/limit        → 5h/周 token 配额%、MCP 月度、套餐等级
 *   - GET {origin}/api/monitor/usage/model-usage?...     → 时间窗内「按模型」token 总量(仅总量,无输入/输出拆分)
 *   - GET {origin}/api/monitor/usage/tool-usage?...      → MCP 工具调用次数
 *
 * 鉴权:**裸 API Key**(不加 `Bearer` 前缀),`Authorization: <apiKey>`。
 * 因此本数据源只能给出「区间内按模型 token 总量」+「配额条」,没有日趋势/费用。
 */

const K_KEY = 'zhipu_api_key'
const K_BASE = 'zhipu_base_url'
const K_ERR = 'zhipu_last_error'
const K_DATA = 'zhipu_last_data'

const DEFAULT_BASE = 'https://open.bigmodel.cn'

/* ---------- 配置(meta / env) ---------- */

export const getApiKey = async () =>
  process.env.ZHIPU_API_KEY || (await getDb()).getMeta(K_KEY) || ''
export const getBaseUrl = async () =>
  process.env.ZHIPU_BASE_URL || (await getDb()).getMeta(K_BASE) || DEFAULT_BASE
export const setApiKey = async (k: string) => (await getDb()).setMeta(K_KEY, k.trim())
export const setBaseUrl = async (u: string) => (await getDb()).setMeta(K_BASE, u.trim().replace(/\/$/, ''))

export const getLastError = async () => (await getDb()).getMeta(K_ERR) ?? ''
export const setLastError = async (e: string) => (await getDb()).setMeta(K_ERR, e)
export const getLastData = async () => (await getDb()).getMeta(K_DATA) ?? ''
export const clearLastData = async () => (await getDb()).setMeta(K_DATA, '')

/* ---------- 拉取 ---------- */

const pad = (n: number) => String(n).padStart(2, '0')
/** 智谱时间窗格式:yyyy-MM-dd HH:mm:ss(本地时区) */
const fmtLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

export interface ZhipuQuotaLimit {
  type?: string
  unit?: number
  number?: number
  percentage?: number
  usage?: number
  currentValue?: number
  remaining?: number
  nextResetTime?: number
}
export interface ZhipuQuota {
  limits: ZhipuQuotaLimit[]
  level?: string
}

interface ZhipuEnvelope<T> {
  code?: number
  msg?: string
  success?: boolean
  data?: T
}

function classifyError(code: number | undefined, httpStatus: number): string {
  if (code === 401 || code === 1002 || httpStatus === 401) return '密钥无效或验证失败'
  if (code === 403) return '无权限访问该接口'
  return `智谱接口错误(HTTP ${httpStatus}${code ? ` / code ${code}` : ''})`
}

async function zhipuGet<T>(origin: string, path: string, key: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${origin}${path}`, {
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'TimeoutError' ? '智谱接口超时' : '智谱接口请求失败')
  }
  let body: ZhipuEnvelope<T> | null = null
  try {
    body = (await res.json()) as ZhipuEnvelope<T>
  } catch {
    /* ignore */
  }
  if (!res.ok || !body || body.success === false || (body.code && body.code !== 200)) {
    const code = body?.code
    throw new Error(body?.msg || classifyError(code, res.status))
  }
  return body.data as T
}

/** 配额(5h/周 token、MCP 月度、等级);按量用户可能为空 → 返回 null */
export async function fetchZhipuQuota(): Promise<ZhipuQuota | null> {
  const key = await getApiKey()
  if (!key) return null
  try {
    const origin = await getBaseUrl()
    const data = await zhipuGet<ZhipuQuota>(origin, '/api/monitor/usage/quota/limit', key)
    if (!data || !Array.isArray(data.limits)) return null
    return data
  } catch {
    return null
  }
}

interface ModelUsageData {
  totalUsage?: {
    totalTokensUsage?: number
    modelSummaryList?: Array<{ modelName?: string; totalTokens?: number }>
  }
}

export interface PlatformUsageZhipu extends PlatformUsageBase {
  granularity: 'hour' | 'day'
}

/**
 * 拉取区间内「按模型 token 总量」。
 *
 * 注意:智谱只给总量(无输入/输出/缓存拆分、无逐日),故每个模型聚合成一条 UsageRow,
 * ts 取区间起点(北京日)。柱状图会退化为单点,这是数据源本身的限制。
 */
export async function fetchUsageZhipu(range: UsageRange, filter?: { start?: string; end?: string }): Promise<PlatformUsageZhipu> {
  const key = await getApiKey()
  if (!key) {
    throw usageError('UNCONFIGURED', '未配置智谱 API Key')
  }
  const origin = await getBaseUrl()
  const { start, end } = windowOf(range, filter)
  // 时间窗:start 当天 00:00 → end 次日 00:00(本地时区)
  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  endDate.setDate(endDate.getDate() + 1)
  const qs = `?startTime=${encodeURIComponent(fmtLocal(startDate))}&endTime=${encodeURIComponent(fmtLocal(endDate))}`

  const data = await zhipuGet<ModelUsageData>(origin, `/api/monitor/usage/model-usage${qs}`, key)
  const list = data?.totalUsage?.modelSummaryList ?? []
  const ts = `${start}T00:00:00Z`
  const rows: UsageRow[] = []
  for (const m of list) {
    const model = String(m.modelName ?? '').trim()
    const total = Number(m.totalTokens ?? 0)
    if (!model || total <= 0) continue
    // 无输入/输出拆分:计入 inputTokens,面板「总 tokens」仍正确
    rows.push({
      ts,
      model,
      inputTokens: total,
      outputTokens: 0,
      cacheHitTokens: 0,
      requests: 0,
      source: 'zhipu',
    })
  }

  await setLastError('')
  ;(await getDb()).setMeta(K_DATA, JSON.stringify({ at: Date.now(), rows }))
  return {
    rows,
    models: rows.map((r) => r.model),
    currency: 'CNY',
    granularity: 'day',
    start,
    end,
  }
}

/** 上次成功快照(admin 用) */
export async function getSnapshotStatus(): Promise<{ at: number; count: number } | null> {
  const raw = await getLastData()
  if (!raw) return null
  try {
    const snap = JSON.parse(raw) as { at?: number; rows?: UsageRow[] }
    if (!Array.isArray(snap.rows)) return null
    return { at: snap.at ?? 0, count: snap.rows.length }
  } catch {
    return null
  }
}

/** 上次成功数据回退(供接口在拉取失败时使用) */
export async function getLastRows(): Promise<{ at: number; rows: UsageRow[]; models: string[] } | null> {
  const raw = await getLastData()
  if (!raw) return null
  try {
    const snap = JSON.parse(raw) as { at?: number; rows?: UsageRow[] }
    if (!Array.isArray(snap.rows) || snap.rows.length === 0) return null
    return { at: snap.at ?? 0, rows: snap.rows, models: snap.rows.map((r) => r.model) }
  } catch {
    return null
  }
}

/** 内存缓存(配额,5 分钟) */
const quotaCache = makeTtlCache<ZhipuQuota | null>('__zhipuQuota')
export async function getCachedQuota(): Promise<ZhipuQuota | null> {
  const hit = quotaCache.get('quota')
  if (hit !== undefined) return hit
  const quota = await fetchZhipuQuota()
  quotaCache.set('quota', quota)
  return quota
}
