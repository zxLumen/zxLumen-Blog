import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AiUsageRow, UsageRange, UsageRow } from '@zx/shared'
import { getDb } from './db'
import { granularityOf, windowOf } from './usage/range'

export const GATEWAY_META_KEY = 'ai_gateway_config'

export type ProviderRole = 'chat' | 'embed' | 'both' | 'audio'

/** provider 的上游接口形状:openai=OpenAI 兼容 /audio/transcriptions;deepgram / assemblyai=带说话人分离 */
export type ProviderApi = 'openai' | 'deepgram' | 'assemblyai'

export interface GatewayProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  models: string[]
  enabled: boolean
  role: ProviderRole
  /** 音频 provider 的接口形状(非音频 provider 忽略) */
  api: ProviderApi
}

export interface GatewayApp {
  id: string
  name: string
  token: string
  enabled: boolean
  providerId: string
  model: string
  dailyLimit: number
  totalLimit: number
  /** 音频分钟额度(分钟;0=不限);与 token 额度分开计 */
  audioLimit: number
  note: string
}

export interface GatewayConfig {
  version: number
  chatProviderId: string
  embedProviderId: string
  audioProviderId: string
  providers: GatewayProvider[]
  apps: GatewayApp[]
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i
const TOKEN_RE = /^[a-z0-9_]{8,80}$/i

export function newToken(): string {
  return `zxai_${randomBytes(24).toString('hex')}`
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x).trim()).filter(Boolean))) : []

const nonNegInt = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function normalizeProvider(raw: unknown): GatewayProvider | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  if (!ID_RE.test(id)) return null
  const baseUrl = str(r.baseUrl).replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) return null
  const role: ProviderRole = r.role === 'embed' || r.role === 'both' || r.role === 'audio' ? r.role : 'chat'
  const api: ProviderApi = r.api === 'deepgram' || r.api === 'assemblyai' ? r.api : 'openai'
  return {
    id,
    name: str(r.name, id),
    baseUrl,
    apiKey: str(r.apiKey),
    model: str(r.model),
    models: cleanList(r.models),
    enabled: r.enabled !== false,
    role,
    api,
  }
}

function normalizeApp(raw: unknown): GatewayApp | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  if (!ID_RE.test(id)) return null
  const token = str(r.token)
  return {
    id,
    name: str(r.name, id),
    token: TOKEN_RE.test(token) ? token : newToken(),
    enabled: r.enabled !== false,
    providerId: str(r.providerId),
    model: str(r.model),
    dailyLimit: nonNegInt(r.dailyLimit),
    totalLimit: nonNegInt(r.totalLimit),
    audioLimit: nonNegInt(r.audioLimit),
    note: str(r.note),
  }
}

export function normalizeGatewayConfig(input: unknown): GatewayConfig {
  const r = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const providers = (Array.isArray(r.providers) ? r.providers : [])
    .map(normalizeProvider)
    .filter((p): p is GatewayProvider => p !== null)
  const apps = (Array.isArray(r.apps) ? r.apps : [])
    .map(normalizeApp)
    .filter((a): a is GatewayApp => a !== null)
  const ids = new Set(providers.map((p) => p.id))
  const chatProviderId = ids.has(str(r.chatProviderId)) ? str(r.chatProviderId) : ''
  const embedProviderId = ids.has(str(r.embedProviderId)) ? str(r.embedProviderId) : ''
  const audioProviderId = ids.has(str(r.audioProviderId)) ? str(r.audioProviderId) : ''
  return { version: 1, chatProviderId, embedProviderId, audioProviderId, providers, apps }
}

function legacySeed(): GatewayConfig {
  const db = getDb()
  let bot: Record<string, unknown> = {}
  try {
    bot = JSON.parse(db.getMeta('chatbot_config') || '{}') as Record<string, unknown>
  } catch {
    bot = {}
  }
  const providers: GatewayProvider[] = []
  const chatKey = db.getMeta('chatbot_chat_key') || ''
  if (chatKey) {
    providers.push({
      id: 'chat-default',
      name: '默认对话',
      baseUrl: str(bot.chatBaseUrl),
      apiKey: chatKey,
      model: '',
      models: [],
      enabled: true,
      role: 'chat',
      api: 'openai',
    })
  }
  const embedKey = db.getMeta('chatbot_embed_key') || ''
  if (embedKey) {
    providers.push({
      id: 'embed-default',
      name: '默认向量',
      baseUrl: str(bot.embedBaseUrl),
      apiKey: embedKey,
      model: '',
      models: [],
      enabled: true,
      role: 'embed',
      api: 'openai',
    })
  }
  return normalizeGatewayConfig({
    chatProviderId: chatKey ? 'chat-default' : '',
    embedProviderId: embedKey ? 'embed-default' : '',
    providers,
    apps: [],
  })
}

export function getGatewayConfig(): GatewayConfig {
  const raw = getDb().getMeta(GATEWAY_META_KEY)
  if (raw === null) return legacySeed()
  try {
    return normalizeGatewayConfig(JSON.parse(raw) as unknown)
  } catch {
    return normalizeGatewayConfig(null)
  }
}

export function saveGatewayConfig(input: unknown): GatewayConfig {
  const cur = getGatewayConfig()
  const cfg = normalizeGatewayConfig(input)
  cfg.providers = cfg.providers.map((p) => {
    if (p.apiKey) return p
    const prev = cur.providers.find((x) => x.id === p.id)
    return prev ? { ...p, apiKey: prev.apiKey } : p
  })
  getDb().setMeta(GATEWAY_META_KEY, JSON.stringify(cfg))
  return cfg
}

export function maskKey(key: string): string {
  const k = (key ?? '').trim()
  if (!k) return ''
  if (k.length <= 8) return '****'
  return `••••${k.slice(-4)}`
}

export function getDefaultProvider(kind: 'chat' | 'embed' | 'audio'): GatewayProvider | null {
  const cfg = getGatewayConfig()
  const defId =
    kind === 'embed' ? cfg.embedProviderId : kind === 'audio' ? cfg.audioProviderId : cfg.chatProviderId
  return cfg.providers.find((p) => p.id === defId && p.enabled) ?? null
}

export function resolveAppByToken(token: string): GatewayApp | null {
  const t = (token ?? '').trim()
  if (!t) return null
  const buf = Buffer.from(t)
  for (const app of getGatewayConfig().apps) {
    if (!app.enabled) continue
    const b = Buffer.from(app.token)
    if (b.length === buf.length && timingSafeEqual(b, buf)) return app
  }
  return null
}

export function resolveProvider(
  kind: 'chat' | 'embed' | 'audio',
  app: GatewayApp | null,
  model: string,
): GatewayProvider | null {
  const cfg = getGatewayConfig()
  const pool = cfg.providers.filter(
    (p) => p.enabled && (kind === 'audio' ? p.role === 'audio' : p.role === kind || p.role === 'both'),
  )
  if (app?.providerId) {
    const bound = pool.find((p) => p.id === app.providerId)
    if (bound) return bound
    const anyBound = cfg.providers.find((p) => p.id === app.providerId && p.enabled)
    if (anyBound) return anyBound
  }
  if (model) {
    const byModel = pool.find((p) => p.models.includes(model))
    if (byModel) return byModel
  }
  const defId =
    kind === 'embed' ? cfg.embedProviderId : kind === 'audio' ? cfg.audioProviderId : cfg.chatProviderId
  return pool.find((p) => p.id === defId) ?? pool[0] ?? null
}

/* ---------- 用量(北京日 × 应用 × 密钥池 × 模型;存 ai_usage 表) ---------- */

export const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
/** 北京时 0-23 */
export const bjHour = () => new Date(Date.now() + 8 * 3600_000).getUTCHours()

/** 一行算作多少 tokens(input/output/cache 相加;cache 为 prompt 的子集,入库时已从 input 扣除) */
const tokensOfAi = (r: AiUsageRow) => r.inputTokens + r.outputTokens + r.cacheHitTokens

/** 某应用的用量(额度检查用):token 的今日/累计 + 音频秒数的今日/累计 */
export function getAppUsage(appId: string): {
  today: number
  total: number
  audioToday: number
  audioTotal: number
} {
  const day = bjToday()
  let today = 0
  let total = 0
  let audioToday = 0
  let audioTotal = 0
  for (const r of getDb().listAiUsage()) {
    if (r.appId !== appId) continue
    const t = tokensOfAi(r)
    total += t
    if (r.day === day) today += t
    audioTotal += r.audioSeconds ?? 0
    if (r.day === day) audioToday += r.audioSeconds ?? 0
  }
  return { today, total, audioToday, audioTotal }
}

/** 记录一次网关请求的用量(按天聚合累加) */
export function recordGatewayUsage(input: {
  appId: string
  providerId: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number
  audioSeconds?: number
  requests?: number
}): void {
  getDb().addAiUsage({
    day: bjToday(),
    hour: bjHour(),
    appId: input.appId,
    providerId: input.providerId,
    model: input.model,
    requests: input.requests ?? 1,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheHitTokens: input.cacheHitTokens,
    audioSeconds: input.audioSeconds ?? 0,
  })
}

export function resetAppUsage(appId: string): void {
  getDb().resetAiUsage(appId)
}

/** 区间内网关用量 → UsageRow(apiKey=应用名,serviceAccount=密钥池名);供接口与 SSR 复用。
 *  今天/昨天按小时(24 格),其余区间聚合到天。 */
export function getGatewayUsageRows(
  range: UsageRange,
  filter?: { start?: string; end?: string },
): { rows: UsageRow[]; start: string; end: string; granularity: 'hour' | 'day' } {
  const win = windowOf(range, filter)
  const hourly = granularityOf(range) === 'hour'
  const cfg = getGatewayConfig()
  const appName = new Map(cfg.apps.map((a) => [a.id, a.name || a.id]))
  const provName = new Map(cfg.providers.map((p) => [p.id, p.name || p.id]))
  const map = new Map<string, UsageRow>()
  for (const r of getDb().listAiUsage({ from: win.start, to: win.end })) {
    // 已从配置里删除的应用:不展示其历史用量
    if (!appName.has(r.appId)) continue
    const app = appName.get(r.appId) as string
    const prov = provName.get(r.providerId) ?? (r.providerId || '未绑定密钥')
    const model = r.model || '(未指定模型)'
    const ts = hourly ? `${r.day}T${String(r.hour).padStart(2, '0')}:00:00Z` : `${r.day}T00:00:00Z`
    const k = `${ts}|${model}|${app}|${prov}`
    const cur = map.get(k)
    if (cur) {
      cur.inputTokens += r.inputTokens
      cur.outputTokens += r.outputTokens
      cur.cacheHitTokens += r.cacheHitTokens
      cur.requests = (cur.requests ?? 0) + r.requests
      cur.audioSeconds = (cur.audioSeconds ?? 0) + (r.audioSeconds ?? 0)
    } else {
      map.set(k, {
        ts,
        model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheHitTokens: r.cacheHitTokens,
        requests: r.requests,
        audioSeconds: r.audioSeconds ?? 0,
        source: 'gateway',
        apiKey: app,
        serviceAccount: prov,
      })
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  return { rows, start: win.start, end: win.end, granularity: hourly ? 'hour' : 'day' }
}

/** 校验额度:已用 + 本次预估是否超限;返回错误信息或 null */
export function checkQuota(app: GatewayApp): string | null {
  if (!app.dailyLimit && !app.totalLimit && !app.audioLimit) return null
  const used = getAppUsage(app.id)
  if (app.dailyLimit && used.today >= app.dailyLimit) {
    return `今日额度已用尽(上限 ${app.dailyLimit})`
  }
  if (app.totalLimit && used.total >= app.totalLimit) {
    return `总额度已用尽(上限 ${app.totalLimit})`
  }
  if (app.audioLimit && used.audioTotal >= app.audioLimit * 60) {
    return `音频额度已用尽(上限 ${app.audioLimit} 分钟)`
  }
  return null
}

/** admin 快照:密钥掩码 + 应用用量 */
export function getGatewayStatus() {
  const cfg = getGatewayConfig()
  return {
    config: {
      ...cfg,
      providers: cfg.providers.map((p) => ({
        ...p,
        apiKey: '',
        keyMask: maskKey(p.apiKey),
        hasKey: !!p.apiKey,
      })),
      apps: cfg.apps.map((a) => ({ ...a, usage: getAppUsage(a.id) })),
    },
  }
}
