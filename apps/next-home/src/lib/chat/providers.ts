// 模型 provider 预设(参考 AI-Coding-Practice/01-RAG-Knowledge-QA 的 provider 注册模式)。
// 两种传输协议:
//   openai —— OpenAI 兼容(chat/completions + embeddings)
//   ollama —— 本地 Ollama(/api/chat + /api/embed)
// `embeddings` 标记该供应商是否提供 embedding 接口(用于区分"聊天/向量"两类 provider)。

export type ProviderProtocol = 'openai' | 'ollama'

export interface ProviderPreset {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  embeddings: boolean
}

export const PROVIDERS: ProviderPreset[] = [
  { id: 'ollama', name: '本地 Ollama', protocol: 'ollama', baseUrl: 'http://localhost:11434', embeddings: true },
  { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', embeddings: true },
  { id: 'deepseek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', embeddings: false },
  { id: 'zhipuai', name: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', embeddings: true },
  { id: 'dashscope', name: '通义千问(百炼)', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', embeddings: true },
  { id: 'moonshot', name: 'Moonshot / Kimi', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', embeddings: false },
  { id: 'siliconflow', name: '硅基流动 SiliconFlow', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', embeddings: true },
  { id: 'openrouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', embeddings: false },
  { id: 'opencode-z', name: 'OpenCode Go', protocol: 'openai', baseUrl: 'https://opencode.ai/zen/go/v1', embeddings: false },
  { id: 'custom', name: '自定义(OpenAI 兼容)', protocol: 'openai', baseUrl: '', embeddings: true },
]

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]))

export function listProviders(): ProviderPreset[] {
  return PROVIDERS
}

export function listEmbeddingPresets(): ProviderPreset[] {
  return PROVIDERS.filter((p) => p.embeddings)
}

export function getProvider(id: string): ProviderPreset | undefined {
  return BY_ID.get(id)
}

export function protocolOf(id: string): ProviderProtocol {
  return getProvider(id)?.protocol ?? 'openai'
}

export function defaultBaseUrl(id: string): string {
  const p = getProvider(id)
  if (!p) return ''
  if (p.id === 'custom') return ''
  return p.baseUrl
}

/** 常见 embedding 模型输出维度(用于预填 dim;未收录的交给用户手填) */
export const KNOWN_EMBEDDING_DIMS: Record<string, number> = {
  'bge-m3': 1024,
  'baai/bge-m3': 1024,
  'pro/baai/bge-m3': 1024,
  'nomic-embed-text': 768,
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'embedding-3': 2048,
  'embedding-2': 1024,
  'text-embedding-v3': 1024,
  'text-embedding-v4': 1024,
  'gemini-embedding-001': 3072,
}

export function suggestDim(model: string): number | null {
  return KNOWN_EMBEDDING_DIMS[model.trim().toLowerCase()] ?? null
}

const EMBED_HINTS = ['embed', 'bge', 'gte', 'e5', 'nomic', 'text-embedding']

/** 启发式:模型名看起来像 embedding 模型吗(与 RAG 项目 is_embedding_model 一致) */
export function isEmbeddingModel(model: string): boolean {
  const name = model.toLowerCase()
  return EMBED_HINTS.some((h) => name.includes(h))
}

export function filterByPurpose(models: string[], purpose: 'chat' | 'embedding'): string[] {
  const wantEmbed = purpose === 'embedding'
  return models.filter((m) => isEmbeddingModel(m) === wantEmbed)
}