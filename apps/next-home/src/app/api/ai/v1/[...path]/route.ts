import { randomUUID } from 'node:crypto'
import {
  checkQuota,
  recordGatewayUsage,
  resolveAppByToken,
  resolveProvider,
  type GatewayApp,
  type GatewayProvider,
} from '@/lib/ai-gateway'

export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['chat/completions', 'embeddings', 'models', 'completions'])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-zx-app-token',
}

function readToken(req: Request): string {
  const h = req.headers.get('authorization') || req.headers.get('x-zx-app-token') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return (m ? m[1] : h).trim()
}

interface UsageParts {
  input: number
  output: number
  cache: number
}
const totalOf = (u: UsageParts) => u.input + u.output + u.cache

/** 从上游响应体里取 usage(prompt/completion/cached);cache 从 input 中扣除,保证 input+cache=prompt */
function usageOf(j: unknown): UsageParts | null {
  const u = (
    j as {
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
      }
    }
  )?.usage
  if (!u) return null
  const cache = Math.max(0, u.prompt_tokens_details?.cached_tokens ?? 0)
  const prompt = Math.max(0, u.prompt_tokens ?? 0)
  const output = Math.max(0, u.completion_tokens ?? 0)
  return { input: Math.max(0, prompt - cache), output, cache }
}

async function consumeUsage(
  stream: ReadableStream<Uint8Array>,
  sse: boolean,
  app: GatewayApp,
  provider: GatewayProvider,
  model: string,
) {
  try {
    const reader = stream.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let best: UsageParts | null = null
    const take = (u: UsageParts | null) => {
      if (u && (!best || totalOf(u) >= totalOf(best))) best = u
    }
    const line = (t: string) => {
      const s = t.trim()
      if (!s.startsWith('data:')) return
      const d = s.slice(5).trim()
      if (!d || d === '[DONE]') return
      try {
        take(usageOf(JSON.parse(d)))
      } catch {
        /* ignore */
      }
    }
    if (sse) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          line(buf.slice(0, i))
          buf = buf.slice(i + 1)
        }
      }
      if (buf.trim()) line(buf)
    } else {
      let all = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        all += dec.decode(value, { stream: true })
      }
      try {
        take(usageOf(JSON.parse(all)))
      } catch {
        /* ignore */
      }
    }
    if (best) {
      const u = best as UsageParts
      recordGatewayUsage({
        appId: app.id,
        providerId: provider.id,
        model: model || provider.model || '',
        inputTokens: u.input,
        outputTokens: u.output,
        cacheHitTokens: u.cache,
        requests: 1,
      })
    }
  } catch {
    /* 统计失败不影响转发 */
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params
  const route = (path ?? []).join('/')
  if (!ALLOWED.has(route)) {
    return Response.json({ error: { message: `未知端点:${route}` } }, { status: 404, headers: CORS })
  }

  const app = resolveAppByToken(readToken(req))
  if (!app) {
    return Response.json({ error: { message: '无效或缺失的应用令牌' } }, { status: 401, headers: CORS })
  }
  const quota = checkQuota(app)
  if (quota) {
    return Response.json({ error: { message: quota } }, { status: 429, headers: CORS })
  }

  const kind: 'chat' | 'embed' = route === 'embeddings' ? 'embed' : 'chat'
  const raw = await req.text().catch(() => '')
  let payload: Record<string, unknown> = {}
  if (raw) {
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return Response.json({ error: { message: '请求体非 JSON' } }, { status: 400, headers: CORS })
    }
  }

  const reqModel = typeof payload.model === 'string' ? payload.model : ''
  const provider = resolveProvider(kind, app, app.model || reqModel)
  if (!provider) {
    return Response.json({ error: { message: '未配置可用的上游密钥' } }, { status: 503, headers: CORS })
  }
  const model = app.model || provider.model || reqModel
  if (model && route !== 'models') payload.model = model
  // 流式请求自动补 include_usage,否则上游不回 usage → 统计不到
  if (payload.stream === true) {
    const so = typeof payload.stream_options === 'object' && payload.stream_options ? payload.stream_options : {}
    payload.stream_options = { ...(so as Record<string, unknown>), include_usage: true }
  }

  const target = `${provider.baseUrl}/${route}`
  const headers = new Headers()
  req.headers.forEach((v, k) => {
    const lk = k.toLowerCase()
    if (['host', 'authorization', 'content-length', 'connection', 'accept-encoding', 'x-zx-app-token'].includes(lk)) return
    headers.set(k, v)
  })
  headers.set('authorization', `Bearer ${provider.apiKey}`)
  if (/opencode\.ai\/zen\/go/.test(provider.baseUrl)) {
    if (!headers.has('x-opencode-session')) headers.set('x-opencode-session', randomUUID())
    if (!headers.has('user-agent')) headers.set('user-agent', 'zx-ai-gateway/1.0')
  }
  if (raw || route !== 'models') headers.set('content-type', 'application/json')

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' ? undefined : JSON.stringify(payload),
      signal: req.signal,
    })
  } catch (e) {
    return Response.json(
      { error: { message: `上游不可达:${e instanceof Error ? e.message : 'fetch failed'}` } },
      { status: 502, headers: CORS },
    )
  }

  const ct = upstream.headers.get('content-type') || 'application/json'
  const outHeaders = new Headers(CORS)
  outHeaders.set('content-type', ct)
  outHeaders.set('cache-control', 'no-store')
  outHeaders.set('x-accel-buffering', 'no')

  if (!upstream.body) return new Response(null, { status: upstream.status, headers: outHeaders })

  const [client, monitor] = upstream.body.tee()
  void consumeUsage(monitor, ct.includes('text/event-stream'), app, provider, model)
  return new Response(client, { status: upstream.status, headers: outHeaders })
}

export const POST = handle
export const GET = handle
