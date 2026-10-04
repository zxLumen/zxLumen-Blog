import { isAdmin } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/db'
import { judgePair } from '@/lib/creature/judge-vlm'

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
 *
 * 生产侧的 VLM 精排走 `lib/creature/judge-vlm.ts`(与这里共用提示词与解析),
 * 由 `/api/creatures/top` 在缓存过期时调度,与实验台互不影响。
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

  const res = await judgePair(a, b)
  return Response.json(res)
}
