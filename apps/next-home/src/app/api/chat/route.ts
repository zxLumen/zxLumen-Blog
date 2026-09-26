import { randomUUID } from 'node:crypto'
import { cidCookie, resolveCid } from '@/lib/clientid'
import { getDb, readJson, rateLimit, clientIp } from '@/lib/db'
import { chatProtocol, getChatApiKey, setLastError, validateChatReady, getConfig } from '@/lib/chat/config'
import { streamChat } from '@/lib/chat/llm'
import { buildMessages } from '@/lib/chat/prompt'
import { retrieve } from '@/lib/chat/rag'
import { loadSoul } from '@/lib/chat/soul'

export const dynamic = 'force-dynamic'

interface ChatBody {
  message?: string
  /** 前端带着每次会话最近几轮(≤8),供模型续接语气 */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  session_id?: string
}

/** 北京时今天的 YYYY-MM-DD(与 chat_logs.day 同口径) */
const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

export async function POST(req: Request) {
  const cfg = getConfig()
  const notReady = validateChatReady()
  if (!cfg.enabled) {
    return Response.json({ error: '机器人暂未开放' }, { status: 404 })
  }
  if (notReady) {
    return Response.json({ error: `机器人尚未配置好:${notReady}` }, { status: 503 })
  }

  const ip = clientIp(req)
  if (!rateLimit(ip, 12, 60_000)) {
    return Response.json({ error: '问得太快啦,稍微缓缓' }, { status: 429 })
  }

  const body = await readJson<ChatBody>(req)
  const question = (body?.message ?? '').trim().slice(0, 2000)
  if (!question) return Response.json({ error: '消息不能为空' }, { status: 400 })

  const db = getDb()
  const { cid, isNew } = await resolveCid()
  const day = bjToday()

  // 每日每人上限(站长/MOCK 也统计,口径与统计一致)
  if (cfg.dailyCap > 0) {
    const used = db.countChatByCidDay(cid, day)
    if (used >= cfg.dailyCap) {
      return Response.json({ error: `今日提问次数已达上限(${cfg.dailyCap}),明天再来吧` }, { status: 429 })
    }
  }

  const sessionId = (body?.session_id ?? '').trim() || randomUUID()
  const history = Array.isArray(body?.history)
    ? body!.history!
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 2000) }))
        .slice(-8)
    : []

  // 落库前先记录用户消息(供"每 cid 每日上限"与日志)
  db.addChatLog({ session_id: sessionId, cid, role: 'user', content: question })

  // 组装上下文:人格 + 站点知识 + 检索块 + 历史
  const soul = await loadSoul()
  let hits: Awaited<ReturnType<typeof retrieve>> = []
  try {
    hits = await retrieve(question)
  } catch {
    /* 检索失败不影响对话 */
  }
  const messages = await buildMessages({ cfg, soul, history, question, hits })

  const started = Date.now()
  let streamedText = ''
  const ac = new AbortController()
  req.signal.addEventListener('abort', () => ac.abort(), { once: true })
  const timeout = setTimeout(() => ac.abort(), 90_000)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(rcc) {
      try {
        const r = await streamChat(
          {
            protocol: chatProtocol(),
            baseUrl: cfg.chatBaseUrl,
            apiKey: getChatApiKey(),
            model: cfg.chatModel,
            messages,
            temperature: cfg.temperature,
            maxTokens: cfg.maxTokens,
            signal: ac.signal,
            provider: cfg.chatProvider,
            sessionId,
          },
          (d) => {
            streamedText += d
            try {
              rcc.enqueue(encoder.encode(d))
            } catch {
              /* 客户端断开 */
            }
          },
        )
        if (!streamedText.trim()) {
          const hint =
            r.finishReason === 'length'
              ? '模型输出被 max_tokens 截断(推理模型会先消耗思维链),请在 admin 把「最大输出」调大(建议 4096+)'
              : r.reasoningLen
                ? '模型只返回了思考、没有正式回答(推理模型),请重试或换用非推理模型'
                : '模型没有返回任何内容,请重试'
          throw new Error(hint)
        }
        db.addChatLog({
          session_id: sessionId,
          cid,
          role: 'assistant',
          content: streamedText,
          provider: cfg.chatProvider,
          model: cfg.chatModel,
          in_tokens: r.inTokens ?? 0,
          out_tokens: r.outTokens ?? 0,
          latency_ms: Date.now() - started,
        })
        setLastError('')
        rcc.close()
      } catch (e) {
        const msg = String(e).slice(0, 300)
        setLastError(msg)
        db.addChatLog({
          session_id: sessionId,
          cid,
          role: 'assistant',
          content: streamedText || `[模型出错了] ${msg}`,
          provider: cfg.chatProvider,
          model: cfg.chatModel,
          in_tokens: 0,
          out_tokens: 0,
          latency_ms: Date.now() - started,
        })
        try {
          rcc.enqueue(
            encoder.encode(
              streamedText ? `\n\n[模型出错了,就说到这里] ${msg}` : `[模型出错了] ${msg}`,
            ),
          )
        } catch {
          /* 忽略 */
        }
        try {
          rcc.close()
        } catch {
          /* 忽略 */
        }
      } finally {
        clearTimeout(timeout)
      }
    },
  })

  const res = new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
  if (isNew) res.headers.append('Set-Cookie', cidCookie(cid))
  return res
}