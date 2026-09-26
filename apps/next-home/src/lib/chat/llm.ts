// LLM / embedding 客户端:openai 兼容 + ollama 两种协议,纯 fetch 流式(无 SDK 依赖)。
import { randomUUID } from 'node:crypto'

const DEFAULT_TIMEOUT = 60_000
const UA = 'zx-home-chatbot/1.0 (+https://zxlumen.cn)'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
function isOpenCodeGo(opts: StreamChatOpts): boolean {
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
  return opts.protocol === 'ollama' ? streamOllama(opts, onToken) : streamOpenAi(opts, onToken)
}

/** 非流式单轮补全(蒸馏/分类用,避免在服务器上保留会话) */
export async function completeChat(
  opts: Omit<StreamChatOpts, 'maxTokens' | 'temperature'> & { temperature?: number; maxTokens?: number },
): Promise<string> {
  const parts: string[] = []
  await streamChat(opts, (d) => parts.push(d))
  return parts.join('')
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