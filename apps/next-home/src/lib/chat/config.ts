import { getDb } from '../db'
import {
  getProvider,
  isEmbeddingModel,
  listEmbeddingPresets,
  protocolOf,
  suggestDim,
  type ProviderProtocol,
} from './providers'

// 机器人配置存 meta(不含密钥;API Key 分别存独立 meta 键,admin 接口读取时掩码)。
// 密钥支持 meta 覆盖 + 环境变量回退(与现有 zhipu/deepseek 模式一致)。

const K_CFG = 'chatbot_config'
const K_CHAT_KEY = 'chatbot_chat_key'
const K_EMBED_KEY = 'chatbot_embed_key'
const K_ERR = 'chatbot_last_error'

export interface ChatBotConfig {
  enabled: boolean
  name: string
  /** @deprecated 兼容旧单条;实际展示用 greetings(随机取一条) */
  greeting: string
  /** 多条问候语,进入页面随机取一条 */
  greetings: string[]
  /** 进入页面自动弹出问候语 */
  autoOpen: boolean
  suggestions: string[]
  /** 聊天 provider 预设 id(custom = 自定义 OpenAI 兼容端点) */
  chatProvider: string
  chatBaseUrl: string
  chatModel: string
  temperature: number
  maxTokens: number
  /** embedding provider 预设 id;留空 = 仅关键词检索 */
  embedProvider: string
  embedBaseUrl: string
  embedModel: string
  embedDim: number
  /** 每日每人提问上限(0 = 不限) */
  dailyCap: number
  /** 是否启用知识检索(RAG) */
  rag: boolean
  topK: number
  chunkSize: number
  chunkOverlap: number
  /** 额外人格指令(追加到 system prompt,优先于文件) */
  promptExtra: string
}

export const DEFAULT_CONFIG: ChatBotConfig = {
  enabled: false,
  name: 'Lumen · 子祥的分身',
  greeting: '你好,我是刘子祥的 AI 分身。关于他、他的项目、职业与技术,都可以问我。',
  greetings: [
    '你好,我是刘子祥的 AI 分身。关于他、他的项目、职业与技术,都可以问我。',
    '嗨,想了解子祥点什么?经历、项目、技术栈,我都能聊。',
    '我是子祥的分身,替他在这儿待命,有什么想问的尽管说。',
    '你好呀。子祥的简历、项目、技术方向,或者这个网站本身,都可以问我。',
    '想认识一下子祥?从工作经历到项目细节,问我准没错。',
    '来了?我是子祥的 AI 分身,他的事我基本都知道。',
  ],
  autoOpen: true,
  suggestions: ['介绍一下你自己', '他都做过哪些项目？', '这个网站的 Token 用量怎么看？'],
  chatProvider: 'deepseek',
  chatBaseUrl: '',
  chatModel: '',
  temperature: 0.7,
  /** 单次回复上限(含推理模型思维链);推理模型建议 ≥4096 */
  maxTokens: 4096,
  embedProvider: 'zhipuai',
  embedBaseUrl: '',
  embedModel: 'embedding-3',
  embedDim: 2048,
  dailyCap: 30,
  rag: true,
  topK: 4,
  chunkSize: 500,
  chunkOverlap: 75,
  promptExtra: '',
}

const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []

/** 归一化:迁移旧单条 greeting,补默认,清洗数组 */
function normalize(cfg: ChatBotConfig): ChatBotConfig {
  const greetings = cleanList(cfg.greetings)
  if (greetings.length === 0) greetings.push(...(cfg.greeting ? [cfg.greeting] : DEFAULT_CONFIG.greetings))
  return {
    ...cfg,
    greetings,
    greeting: greetings[0] ?? '',
    suggestions: cleanList(cfg.suggestions),
    autoOpen: typeof cfg.autoOpen === 'boolean' ? cfg.autoOpen : DEFAULT_CONFIG.autoOpen,
  }
}

export function getConfig(): ChatBotConfig {
  const db = getDb()
  const raw = db.getMeta(K_CFG)
  if (!raw) return normalize({ ...DEFAULT_CONFIG })
  try {
    const p = JSON.parse(raw) as Partial<ChatBotConfig>
    return normalize({ ...DEFAULT_CONFIG, ...p })
  } catch {
    return normalize({ ...DEFAULT_CONFIG })
  }
}

export function saveConfig(partial: Partial<ChatBotConfig>): ChatBotConfig {
  const db = getDb()
  const cur = getConfig()
  const next = normalize({
    ...cur,
    ...partial,
    suggestions: Array.isArray(partial.suggestions) ? partial.suggestions : cur.suggestions,
    greetings: Array.isArray(partial.greetings) ? partial.greetings : cur.greetings,
  })
  // 预设 provider:自动同步 baseUrl(未显式覆盖);自定义则保留用户填的端点
  if (!partial.chatBaseUrl || partial.chatBaseUrl === '') {
    const p = getProvider(next.chatProvider)
    if (p && p.id !== 'custom') next.chatBaseUrl = p.baseUrl
  }
  if (!partial.embedBaseUrl || partial.embedBaseUrl === '') {
    const p = getProvider(next.embedProvider)
    if (p && p.id !== 'custom') next.embedBaseUrl = p.baseUrl
  }
  if (next.embedModel && (!partial.embedDim || partial.embedDim <= 0)) {
    const d = suggestDim(next.embedModel)
    if (d) next.embedDim = d
  }
  db.setMeta(K_CFG, JSON.stringify(next))
  return next
}

export function chatProtocol(): ProviderProtocol {
  return protocolOf(getConfig().chatProvider)
}

export function embedProtocol(): ProviderProtocol {
  return protocolOf(getConfig().embedProvider)
}

/* ---------- 密钥 ---------- */

export function getChatApiKey(): string {
  const env = process.env.CHATBOT_API_KEY
  if (env) return env.trim()
  return getDb().getMeta(K_CHAT_KEY) || ''
}

export function getEmbedApiKey(): string {
  const env = process.env.CHATBOT_EMBED_API_KEY
  if (env) return env.trim()
  return getDb().getMeta(K_EMBED_KEY) || ''
}

export function setChatApiKey(key: string): void {
  getDb().setMeta(K_CHAT_KEY, key.trim())
}

export function setEmbedApiKey(key: string): void {
  getDb().setMeta(K_EMBED_KEY, key.trim())
}

export function clearChatApiKey(): void {
  getDb().delMeta(K_CHAT_KEY)
}

export function clearEmbedApiKey(): void {
  getDb().delMeta(K_EMBED_KEY)
}

/** 掩码(仅展示):保留末尾 4 位 */
export function maskKey(key: string): string {
  const k = (key ?? '').trim()
  if (!k) return ''
  if (k.length <= 8) return '****'
  return `••••${k.slice(-4)}`
}

/* ---------- 状态 ---------- */

export function setLastError(e: string): void {
  getDb().setMeta(K_ERR, e.slice(0, 2000))
}

export function getLastError(): string {
  return getDb().getMeta(K_ERR) || ''
}

/** admin 面板用摘要:已配置的聊天/向量状态 + provider 元信息 */
export function getBotStatus() {
  const cfg = getConfig()
  const chatKey = getChatApiKey()
  const embedKey = getEmbedApiKey()
  const chatCfg = {
    provider: cfg.chatProvider,
    baseUrl: cfg.chatBaseUrl,
    model: cfg.chatModel,
    hasKey: !!chatKey,
  }
  const embedCfg = {
    provider: cfg.embedProvider,
    baseUrl: cfg.embedBaseUrl,
    model: cfg.embedModel,
    dim: cfg.embedDim,
    hasKey: !!embedKey,
  }
  const embeddingPresets = listEmbeddingPresets()
  return {
    config: { ...cfg, chatApiKey: maskKey(chatKey), embedApiKey: maskKey(embedKey) },
    chatCfg,
    embedCfg,
    embeddingPresets,
    lastError: getLastError(),
    chatReady: chatKey !== '',
    embedReady: embedKey !== '' && cfg.embedModel !== '' && cfg.embedDim > 0,
  }
}

/** 校验:启用聊天必须配置可用的聊天 provider(模型 + 密钥 + 合法端点) */
export function validateChatReady(): string | null {
  const cfg = getConfig()
  if (!cfg.enabled) return '机器人未启用'
  if (!cfg.chatModel) return '未配置聊天模型'
  const key = getChatApiKey()
  if (!key) return '未配置聊天 API Key'
  if (!/^https?:\/\//.test(cfg.chatBaseUrl)) return '聊天 baseUrl 非法'
  return null
}

/** 校验 embedding 是否可用(向量部分),不可用则回退关键词检索 */
export function embedReady(): boolean {
  const cfg = getConfig()
  if (!cfg.embedProvider || !cfg.embedModel) return false
  const key = getEmbedApiKey()
  if (!key && !cfg.embedBaseUrl.startsWith('http://localhost') && cfg.embedProvider !== 'ollama') return false
  return /^https?:\/\//.test(cfg.embedBaseUrl) || cfg.embedProvider === 'custom' || cfg.embedProvider === 'ollama'
}

/** 按名称给 embedding 模型补一个建议维度(未知则保持用户填的值) */
export function suggestedDimFor(model: string): number | null {
  return isEmbeddingModel(model) ? suggestDim(model) : null
}