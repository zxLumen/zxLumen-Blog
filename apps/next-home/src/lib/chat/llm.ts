// LLM / embedding 客户端:openai 兼容 + ollama 两种协议,纯 fetch 流式(无 SDK 依赖)。
import { randomUUID } from 'node:crypto'
import { sanitizeText } from './sanitize'

const DEFAULT_TIMEOUT = 60_000
const UA = 'zx-home-chatbot/1.0 (+https://zxlumen.cn)'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 多模态消息(图片理解用)。
 *
 * 只在「图片自检」等少数场景用,所以**没有**把它并进 `ChatMessage` ——
 * 那会改动所有既有调用点与类型收窄。OpenAI 兼容协议里图片是 content 数组的一个 part,
 * 这里直接按该形状构造即可(见 `imageMessage`)。
 */
export interface ImageMessage {
  role: 'user'
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  >
}

/** 构造一条「文本 + 一张 data URL 图」的用户消息 */
export function imageMessage(text: string, imageDataUrl: string): ImageMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  }
}

export interface StreamChatOpts {
  protocol: 'openai' | 'ollama'
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /** provider 预设 id(用于识别 OpenCode Go 等需特殊头的服务) */
  provider?: string
  /** 会话 id:OpenCode Go 需 `x-opencode-session` 做路由与 prompt 缓存 */
  sessionId?: string
  /** 出站脱敏:发送前把每条消息里的敏感信息掩码(仅蒸馏等管理侧开启,访客问答不加开销) */
  sanitize?: boolean
}

export interface StreamChatResult {
  text: string
  /** 供应商回传的用量(带 include_usage 时);缺省为 undefined */
  inTokens?: number
  outTokens?: number
  /** 结束原因:'stop' | 'length' 等(截断时为 'length') */
  finishReason?: string
  /** 推理模型思维链字符数(仅用于诊断;不计入 text) */
  reasoningLen?: number
}

function ensureUrl(base: string): string {
  return base.replace(/\/+$/, '')
}

/** OpenCode Go 需自定义 UA + 稳定的会话头;其它 OpenAI 兼容端点不需要 */
function isOpenCodeGo(opts: { provider?: string; baseUrl: string }): boolean {
  return opts.provider === 'opencode-z' || /opencode\.ai\/zen\/go/.test(opts.baseUrl)
}

/** OpenAI 兼容协议(DeepSeek / OpenAI / 智谱 / 百炼 / 硅基 / OpenRouter / OpenCode Go) */
async function streamOpenAi(opts: StreamChatOpts, onToken: (d: string) => void): Promise<StreamChatResult> {
  const url = `${ensureUrl(opts.baseUrl)}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
  }
  if (isOpenCodeGo(opts)) {
    headers['x-opencode-session'] = opts.sessionId || randomUUID()
    headers['User-Agent'] = UA
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1024,
      stream_options: { include_usage: true },
    }),
    signal: opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`模型接口 HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
  return consumeSse(res, onToken)
}

async function consumeSse(res: Response, onToken: (d: string) => void): Promise<StreamChatResult> {
  if (!res.body) throw new Error('模型接口无响应体')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let reasoningLen = 0
  let finishReason: string | undefined
  let inTokens: number | undefined
  let outTokens: number | undefined

  const handleLine = (line: string) => {
    const t = line.trim()
    if (!t.startsWith('data:')) return
    const data = t.slice(5).trim()
    if (data === '[DONE]') return
    try {
      const j = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }>
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null
      }
      const ch = j.choices?.[0]
      const delta = ch?.delta?.content
      if (delta) {
        text += delta
        onToken(delta)
      }
      // 推理模型的思维链:不计入正文,只统计长度用于诊断
      if (ch?.delta?.reasoning_content) reasoningLen += ch.delta.reasoning_content.length
      if (ch?.finish_reason) finishReason = ch.finish_reason
      if (j.usage) {
        inTokens = j.usage.prompt_tokens
        outTokens = j.usage.completion_tokens
      }
    } catch {
      /* 忽略解析失败的行 */
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      handleLine(line)
    }
  }
  if (buf.trim()) handleLine(buf)
  return { text, inTokens, outTokens, finishReason, reasoningLen }
}

/** Ollama 原生 /api/chat 流(NDJSON) */
async function streamOllama(opts: StreamChatOpts, onToken: (d: string) => void): Promise<StreamChatResult> {
  const url = `${ensureUrl(opts.baseUrl)}/api/chat`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      options: { temperature: opts.temperature ?? 0.7, num_predict: opts.maxTokens ?? 1024 },
    }),
    signal: opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ollama HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
  if (!res.body) throw new Error('Ollama 无响应体')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let chunks: number | undefined
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line.startsWith('{')) continue
      try {
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number }
        const d = j.message?.content
        if (d) {
          text += d
          onToken(d)
        }
        if (j.done) {
          chunks = (j.prompt_eval_count ?? 0) + (j.eval_count ?? 0)
        }
      } catch {
        /* 忽略 */
      }
    }
  }
  return { text, inTokens: chunks }
}

export async function streamChat(
  opts: StreamChatOpts,
  onToken: (d: string) => void,
): Promise<StreamChatResult> {
  if (opts.sanitize) {
    opts = {
      ...opts,
      messages: opts.messages.map((m) => ({ ...m, content: sanitizeText(m.content).text })),
    }
  }
  return opts.protocol === 'ollama' ? streamOllama(opts, onToken) : streamOpenAi(opts, onToken)
}

/** 非流式单轮补全,返回完整结果(含 finishReason/reasoningLen,供截断判断与诊断) */
export async function completeChatFull(
  opts: Omit<StreamChatOpts, 'maxTokens' | 'temperature'> & { temperature?: number; maxTokens?: number },
): Promise<StreamChatResult> {
  return streamChat(opts, () => {})
}

/** 非流式单轮补全(蒸馏/分类用,避免在服务器上保留会话) */
export async function completeChat(
  opts: Omit<StreamChatOpts, 'maxTokens' | 'temperature'> & { temperature?: number; maxTokens?: number },
): Promise<string> {
  return (await completeChatFull(opts)).text
}

/**
 * 带图片的单轮补全(图片理解/视觉自检)。
 *
 * 只走 OpenAI 兼容协议 —— 当前支持读图的 DeepSeek V4.1-Flash / 智谱 GLM-4V 等都在这条协议下;
 * Ollama 的多模态消息形状不同,这里直接不支持(抛错让调用方兜底),比静默发出去被拒更清楚。
 */
export async function completeChatWithImage(opts: {
  protocol: 'openai' | 'ollama'
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  imageDataUrl: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  /** provider 预设 id / 会话 id:OpenCode Go 必须带 `x-opencode-session`,否则 400 */
  provider?: string
  sessionId?: string
}): Promise<string> {
  if (opts.protocol !== 'openai') throw new Error('图片理解当前仅支持 OpenAI 兼容端点')
  const url = `${ensureUrl(opts.baseUrl)}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
  }
  // 与文本链路共用同一套「特殊头」判定,否则 OpenCode Go 会以 MissingSessionID 拒掉
  if (isOpenCodeGo(opts)) {
    headers['x-opencode-session'] = opts.sessionId || randomUUID()
    headers['User-Agent'] = UA
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: [imageMessage(opts.prompt, opts.imageDataUrl)],
      stream: false,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 512,
    }),
    signal: opts.signal ?? AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`图片模型 HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

/* ---------- embedding ---------- */

export interface EmbedOpts {
  protocol: 'openai' | 'ollama'
  baseUrl: string
  apiKey: string
  model: string
  texts: string[]
}

/** 批量 embedding;返回每个文本的向量数组 */
export async function embedTexts(opts: EmbedOpts): Promise<number[][]> {
  if (!opts.texts.length) return []
  const base = ensureUrl(opts.baseUrl)
  if (opts.protocol === 'ollama') {
    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model, input: opts.texts, keep_alive: '30m' }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`)
    const j = (await res.json()) as { embeddings?: number[][] }
    return j.embeddings ?? []
  }
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ model: opts.model, input: opts.texts }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Embedding HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
  const j = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>
    error?: { message?: string }
    msg?: string
  }
  if (j.error?.message || j.msg) throw new Error(j.error?.message || j.msg)
  return (j.data ?? []).map((d) => d.embedding ?? [])
}