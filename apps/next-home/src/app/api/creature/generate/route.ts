import { randomUUID } from 'node:crypto'
import { clientIp, rateLimit } from '@/lib/db'
import { chatProtocol, getChatApiKey, getConfig } from '@/lib/chat/config'
import { completeChat } from '@/lib/chat/llm'
import { defaultBaseUrl } from '@/lib/chat/providers'
import { normalizeBlueprint, compileBlueprint, type CreatureBlueprint } from '@zx/shared/creature'
import { buildGenerateMessages, GENERATE_BUDGETS } from '@/components/lab/blueprint/GENERATE_PROMPT'
import { extractJson } from '@/components/lab/blueprint/json'

export const dynamic = 'force-dynamic'

interface Body {
  descr?: string
  /** 重试提示:把上一次的问题带回给模型 */
  retryHint?: string
}

/** 生成结果缓存:同一句描述直接复用,避免反复烧 token(进程内,重启即清) */
const cache = new Map<string, CreatureBlueprint>()

function modelTarget() {
  const cfg = getConfig()
  const baseUrl = cfg.chatBaseUrl || defaultBaseUrl(cfg.chatProvider)
  const model = cfg.chatModel || 'deepseek-flash'
  return { cfg, baseUrl, model, apiKey: getChatApiKey() }
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!rateLimit(`creature-gen:${ip}`, 20, 60_000)) {
    return Response.json({ error: '生成太频繁,稍等一下' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const descr = (body.descr ?? '').trim().slice(0, 300)
  if (!descr) return Response.json({ error: '描述不能为空' }, { status: 400 })

  const { baseUrl, model, apiKey } = modelTarget()
  if (!apiKey) {
    return Response.json({ error: '未配置模型 API Key(admin → 机器人)' }, { status: 503 })
  }
  if (!/^https?:\/\//.test(baseUrl)) {
    return Response.json({ error: '模型端点未配置' }, { status: 503 })
  }

  const key = descr
  if (!body.retryHint) {
    const hit = cache.get(key)
    if (hit) return Response.json({ blueprint: hit, cached: true })
  }

  const started = Date.now()
  const messages = buildGenerateMessages(descr, body.retryHint)
  let bp: CreatureBlueprint | null = null
  let lastRaw = ''
  let lastErr = ''

  // 预算阶梯:推理模型会先写思维链,给小了会「思考完但正文被截断」→ 空响应。
  for (const maxTokens of GENERATE_BUDGETS) {
    let raw: string
    try {
      raw = await completeChat({
        protocol: chatProtocol(),
        baseUrl,
        apiKey,
        model,
        messages,
        temperature: 1.0,
        maxTokens,
        signal: AbortSignal.timeout(120_000),
        sessionId: randomUUID(),
      })
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      continue
    }
    lastRaw = raw
    const parsed = extractJson(raw)
    const candidate = normalizeBlueprint(parsed)
    if (candidate) {
      bp = candidate
      break
    }
    lastErr = parsed ? 'JSON 结构不符合骨架要求' : '响应里没有可解析的 JSON'
  }

  if (!bp) {
    return Response.json(
      {
        error: lastErr || '模型没有给出可用的骨架',
        raw: lastRaw.slice(0, 400),
      },
      { status: 422 },
    )
  }

  cache.set(key, bp)
  const compiled = compileBlueprint(bp)
  return Response.json({
    blueprint: bp,
    parts: compiled.rig.parts.length,
    ms: Date.now() - started,
  })
}
