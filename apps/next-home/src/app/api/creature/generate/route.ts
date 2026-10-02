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
  const body = (await req.json().catch(() => ({}))) as Body
  const descr = (body.descr ?? '').trim().slice(0, 300)
  if (!descr) return Response.json({ error: '描述不能为空' }, { status: 400 })

  /**
   * **缓存命中不走限流。**
   *
   * 限流是为了保护模型配额,而缓存命中一次模型都不调;若把命中也算进去,
   * 用户「重复点已生成过的描述」就会白白吃掉配额,很快 429。所以先查缓存再判限流。
   */
  const key = descr
  if (!body.retryHint) {
    const hit = cache.get(key)
    if (hit) return Response.json({ blueprint: hit, cached: true, ms: 0 })
  }

  /**
   * 限流:本机/dev 下所有浏览器与脚本共享同一个 `clientIp`(通常是 'local'),
   * 所以额度要给得宽一些。单次生成要 20~60s,真正瓶颈是「在途请求数」,
   * 这里用一个**并发闸**兜住:同时在途的生成最多 4 个,超过直接 429。
   */
  const ip = clientIp(req)
  if (inflight >= MAX_INFLIGHT) {
    return Response.json({ error: '当前生成的人有点多,稍等几秒再试' }, { status: 429 })
  }
  if (!rateLimit(`creature-gen:${ip}`, 60, 60_000)) {
    return Response.json({ error: '生成太频繁,稍等一下' }, { status: 429 })
  }

  const { baseUrl, model, apiKey } = modelTarget()
  if (!apiKey) {
    return Response.json({ error: '未配置模型 API Key(admin → 机器人)' }, { status: 503 })
  }
  if (!/^https?:\/\//.test(baseUrl)) {
    return Response.json({ error: '模型端点未配置' }, { status: 503 })
  }

  inflight++
  try {
    const result = await generateOnce(descr, body.retryHint, { baseUrl, model, apiKey })
    if ('error' in result) {
      return Response.json({ error: result.error, raw: result.raw }, { status: result.status })
    }
    cache.set(key, result.bp)
    const compiled = compileBlueprint(result.bp)
    return Response.json({
      blueprint: result.bp,
      parts: compiled.rig.parts.length,
      ms: Date.now() - result.started,
    })
  } finally {
    inflight--
  }
}

/** 在途生成数(进程内);挡住把上游配额一次性打爆 */
let inflight = 0
const MAX_INFLIGHT = 4

async function generateOnce(
  descr: string,
  retryHint: string | undefined,
  t: { baseUrl: string; model: string; apiKey: string },
): Promise<{ bp: CreatureBlueprint; started: number } | { error: string; raw: string; status: number }> {
  const started = Date.now()
  /**
   * **总时限**,而不是「每次尝试各 120s」。
   *
   * 之前三次预算阶梯各有独立超时,最坏 3×120s=6 分钟,用户会以为页面卡死。
   * 现在整条链路共享一个 deadline,超了就不再往下试。
   */
  const DEADLINE = 180_000
  const messages = buildGenerateMessages(descr, retryHint)
  let lastRaw = ''
  let lastErr = ''

  for (const maxTokens of GENERATE_BUDGETS) {
    const remain = DEADLINE - (Date.now() - started)
    if (remain < 20_000) break // 剩下的时间不够一次生成,别再开新一轮
    let raw: string
    try {
      raw = await completeChat({
        protocol: chatProtocol(),
        baseUrl: t.baseUrl,
        apiKey: t.apiKey,
        model: t.model,
        messages,
        temperature: 1.0,
        maxTokens,
        signal: AbortSignal.timeout(Math.min(remain, 150_000)),
        sessionId: randomUUID(),
      })
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      continue
    }
    lastRaw = raw
    const parsed = extractJson(raw)
    const candidate = normalizeBlueprint(parsed)
    if (candidate) return { bp: candidate, started }
    lastErr = parsed ? 'JSON 结构不符合骨架要求' : '响应里没有可解析的 JSON'
  }

  return { error: lastErr || '模型没有给出可用的骨架', raw: lastRaw.slice(0, 400), status: 422 }
}
