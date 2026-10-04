import { isAdmin } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/db'
import { chatProtocol, getChatApiKey, getConfig } from '@/lib/chat/config'
import { completeChatFull, type ContentPart } from '@/lib/chat/llm'
import { defaultBaseUrl } from '@/lib/chat/providers'

export const dynamic = 'force-dynamic'

/**
 * 视觉裁判(审美排序**验证实验**用)—— 见 `/lab/judge`。
 *
 * 只做一件事:收两张**已经渲染好的**生物图(data URL),问视觉模型「哪个更好看」,
 * 返回裁决。**不**负责渲染(渲染在浏览器端用真实渲染器完成)、**不**负责聚合排序
 * (聚合用 `@zx/shared/creature` 的 `fitBradleyTerry`)。
 *
 * 为什么是**成对**而不是让模型打 0~100:
 *  视觉/语言模型直接打点分天生向中间塌缩(一堆样本全挤在一起),而「A 和 B 哪个好」
 *  这种比较问题稳定得多。排序信息在「比较」里,不在「打分」里。研究与实测都支持。
 *
 * ⚠ 这是**实验接口**,不是生产链路:
 *   - 仅站长可用(admin-only)。访客碰不到。
 *   - 每次调用都真花钱(图片按 input token 计费),所以有每 IP 每分钟的滑动窗口限流,
 *     防止页面 bug 或手滑把 key 刷爆。
 *   - 结果不落库。等方向被验证后,才会考虑缓存进库、锚定、转单张。
 */

interface Body {
  /** 两张图的 data URL(`data:image/png;base64,...`) */
  a?: string
  b?: string
  /** 提示词版本号;换 prompt 时递增,便于对比不同 prompt 的效果 */
  promptVersion?: string
}

/** 只接受 png/jpeg/webp/gif 的 data URL,长度设上限防超大 base64 灌进来 */
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i
const MAX_DATA_URL = 6_000_000 // ~4.5MB 二进制,足够一张 box<=320 的 PNG

function bad(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status })
}

/**
 * 裁判提示词。
 *
 * 三条设计:
 *  1. **强制先写「具体视觉差异」再裁决** —— 这是防「没看图、凭文字瞎判」
 *     (informativeness bias)的直接手段:逼它先落到图上像素级的东西。
 *  2. 只允许 A / B / 平局 三个答案,便于解析;**平局是合法答案**,不该逼模型硬选。
 *  3. 明确「你是比较审美观感,不是比较谁更复杂/谁部件多」—— 否则模型容易
 *     把「更繁复」当成「更好看」,而那正是我们要它超越的启发式偏差。
 */
const SYSTEM = `你是一位视觉审美评委。用户会给你两张生物插画(A 和 B),你要判断哪一张**看起来更好看**。

规则:
- 只评判**审美观感**:构图、配色和谐、形体完整度、有没有记忆点、有没有明显的视觉缺陷(比如糊成一团、颜色刺眼、比例失衡)。
- **不要**因为「更复杂 / 部件更多 / 更花哨」就认为更好看。简洁而整洁,可以胜过繁复而杂乱。
- **先写一句「两张图的具体视觉差异」**(必须落到图上真实存在的东西,不要空话),再给结论。
- 结论只能是这三个之一,单独一行:【A】【B】【平局】

输出格式(严格遵守):
差异:<一句话,说出你在图里实际看到的区别>
结论:【A】 或 【B】 或 【平局】`

function judgeUserMessage(a: string, b: string): ContentPart[] {
  return [
    { type: 'text', text: '下面依次是图 A 和图 B。请按规则评判,先写差异,再给结论。' },
    { type: 'text', text: '图 A:' },
    { type: 'image_url', image_url: { url: a, detail: 'low' } },
    { type: 'text', text: '图 B:' },
    { type: 'image_url', image_url: { url: b, detail: 'low' } },
  ]
}

type Verdict = 'A' | 'B' | '平局'

/** 从模型回复里解析裁决。宽容处理:优先看【A】/【B】/【平局】标记 */
function parseVerdict(text: string): { verdict: Verdict | null; reason: string } {
  const reason = text.match(/差异[:：]\s*(.+)/)?.[1]?.trim() ?? ''
  const m = text.match(/【\s*(A|B|平局)\s*】/i)
  if (m) {
    const v = m[1]!.toUpperCase()
    return { verdict: v === 'A' || v === 'B' ? (v as Verdict) : '平局', reason }
  }
  // 兜底:没有标记时,看整段里哪个词先出现(次序即偏好)
  const tail = text.slice(-80)
  const ai = tail.lastIndexOf('A')
  const bi = tail.lastIndexOf('B')
  const tie = tail.lastIndexOf('平局')
  if (tie >= 0 && tie > ai && tie > bi) return { verdict: '平局', reason }
  if (ai >= 0 || bi >= 0) return { verdict: ai > bi ? 'A' : 'B', reason }
  return { verdict: null, reason }
}

export async function POST(req: Request): Promise<Response> {
  // 仅站长:这是实验工具,不进产品链路
  if (!(await isAdmin())) return bad('未登录', 401)

  // 滑动窗口限流:裁判每次真花钱,页面 bug 也可能刷爆 key
  const ip = clientIp(req)
  if (!rateLimit(`judge:${ip}`, 240, 60_000)) {
    return Response.json({ error: '判得太快,缓一秒', retryable: true }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const { a, b } = body
  if (!a || !b) return bad('缺少两张图')
  if (!DATA_URL_RE.test(a) || !DATA_URL_RE.test(b)) return bad('图片格式不支持(需 png/jpeg/webp/gif data URL)')
  if (a.length > MAX_DATA_URL || b.length > MAX_DATA_URL) return bad('图片太大')

  const cfg = getConfig()
  const baseUrl = cfg.chatBaseUrl || defaultBaseUrl(cfg.chatProvider)
  const apiKey = getChatApiKey()
  if (!apiKey) return bad('未配置模型 API Key(admin → 机器人)', 503)
  if (!/^https?:\/\//.test(baseUrl)) return bad('模型端点未配置', 503)

  const started = Date.now()
  try {
    const res = await completeChatFull({
      protocol: chatProtocol(),
      baseUrl,
      apiKey,
      model: cfg.chatModel || 'deepseek-v4.1-flash',
      provider: cfg.chatProvider,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: judgeUserMessage(a, b) },
      ],
      temperature: 0,
      // 思维链 + 差异 + 结论,给足;截断会让裁决解析不到
      maxTokens: 900,
    })
    const { verdict, reason } = parseVerdict(res.text)
    return Response.json({
      verdict,
      reason,
      ms: Date.now() - started,
      inTokens: res.inTokens,
      outTokens: res.outTokens,
      // 截断诊断:finishReason==='length' 时正文可能被切,裁决不可信
      finishReason: res.finishReason,
      raw: res.text,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '裁判调用失败'
    return Response.json({ error: msg }, { status: 502 })
  }
}
