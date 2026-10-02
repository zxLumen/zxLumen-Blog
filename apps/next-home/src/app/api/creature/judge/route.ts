import { randomUUID } from 'node:crypto'
import { clientIp, rateLimit } from '@/lib/db'
import { chatProtocol, getChatApiKey, getConfig } from '@/lib/chat/config'
import { completeChatWithImage } from '@/lib/chat/llm'
import { defaultBaseUrl } from '@/lib/chat/providers'
import { extractJson } from '@/components/lab/blueprint/json'

export const dynamic = 'force-dynamic'

interface Body {
  descr?: string
  /** 渲染结果的 PNG data URL */
  image?: string
}

const JUDGE_PROMPT = (descr: string) => `这是一张程序生成的虚构生物图像(游戏/养成场景用的扁平插画)。用户的描述是:

「${descr}」

请只输出一个 JSON 对象,不要解释:
{ "score": 0-10 的整数, "looksLike": "你认为它像什么(2-6 字)", "issues": ["最主要的问题,最多 2 条"], "advice": "给建模器的具体修改建议(≤40 字)" }

评分标准:
- 8-10:一眼就能认出描述里的物种,结构完整、比例自然。
- 5-7:大致像,但有明显问题(比例怪 / 部件错位 / 缺关键特征)。
- 0-4:看不出是什么,或结构严重崩坏。`

/** 图片体积上限(约 1.2MB base64),避免把大图塞给模型 */
const MAX_IMAGE_CHARS = 1_600_000

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!rateLimit(`creature-judge:${ip}`, 30, 60_000)) {
    return Response.json({ error: '太频繁' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const descr = (body.descr ?? '').trim().slice(0, 300)
  const image = body.image ?? ''
  if (!descr) return Response.json({ error: '缺少描述' }, { status: 400 })
  if (!image.startsWith('data:image/')) return Response.json({ error: '缺少图像' }, { status: 400 })
  if (image.length > MAX_IMAGE_CHARS) return Response.json({ error: '图像过大' }, { status: 413 })

  const cfg = getConfig()
  const baseUrl = cfg.chatBaseUrl || defaultBaseUrl(cfg.chatProvider)
  const model = cfg.chatModel || 'deepseek-flash'
  const apiKey = getChatApiKey()
  if (!apiKey || !/^https?:\/\//.test(baseUrl)) {
    return Response.json({ error: '视觉自检未配置模型' }, { status: 503 })
  }

  let raw: string
  try {
    raw = await completeChatWithImage({
      protocol: chatProtocol(),
      baseUrl,
      apiKey,
      model,
      prompt: JUDGE_PROMPT(descr),
      imageDataUrl: image,
      signal: AbortSignal.timeout(60_000),
      provider: cfg.chatProvider,
      sessionId: randomUUID(),
    })
  } catch (e) {
    return Response.json({ error: `自检模型调用失败:${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  const j = extractJson(raw) as
    | { score?: unknown; looksLike?: unknown; issues?: unknown; advice?: unknown }
    | null
  if (!j) return Response.json({ error: '自检没有给出 JSON', raw: raw.slice(0, 300) }, { status: 422 })

  const score = Math.max(0, Math.min(10, Math.round(Number(j.score) || 0)))
  const issues = Array.isArray(j.issues) ? j.issues.filter((x) => typeof x === 'string').slice(0, 2) : []
  return Response.json({
    score,
    looksLike: typeof j.looksLike === 'string' ? j.looksLike.slice(0, 12) : '',
    issues,
    advice: typeof j.advice === 'string' ? j.advice.slice(0, 80) : '',
  })
}
