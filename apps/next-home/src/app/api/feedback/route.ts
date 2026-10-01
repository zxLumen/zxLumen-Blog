import { getDb } from '@/lib/db'
import { clientIp, rateLimit, readJson } from '@/lib/db'
import { resolveCid } from '@/lib/clientid'
import { getContactSettings } from '@/lib/settings'
import { feedbackFrom, sendFeedbackEmail } from '@/lib/mail'

export const dynamic = 'force-dynamic'

/** 常见爬虫/扫描器 UA:表单它不会填,直接当没收到 */
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|headless|python-requests|curl|wget|go-http-client|axios|node-fetch/i

const MAX_MSG = 2000
const MAX_CONTACT = 200
const MAX_PATH = 500

interface Body {
  message?: string
  /** 选填联系方式(方便回复) */
  contact?: string
  /** 反馈时所在页面(路径 + hash) */
  path?: string
  /** 蜜罐:机器人才会填,非空直接当成功、什么也不做 */
  website?: string
}

/** 把反馈发给站长邮箱:目标邮箱 FEEDBACK_TO 优先,否则用站点联系方式 */
async function feedbackTo(): Promise<string> {
  const env = process.env.FEEDBACK_TO
  if (env) return env
  const { email } = await getContactSettings()
  return email || 'service@zxlumen.cn'
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent') ?? ''
  if (BOT_RE.test(ua)) return Response.json({ ok: true })

  if (!rateLimit(`feedback:${ip}`, 3, 60_000)) {
    return Response.json({ error: '太频繁了,请稍后再试' }, { status: 429 })
  }

  const data = await readJson<Body>(req)
  if (!data) return Response.json({ error: '请求体无效' }, { status: 400 })

  // 蜜罐命中:假装成功,不落库不发信
  if (data.website && data.website.length > 0) return Response.json({ ok: true })

  const message = (data.message ?? '').trim()
  const contact = (data.contact ?? '').trim().slice(0, MAX_CONTACT)
  const path = (data.path ?? '').trim().slice(0, MAX_PATH)
  if (message.length === 0 || message.length > MAX_MSG) {
    return Response.json({ error: `反馈内容需 1-${MAX_MSG} 字` }, { status: 400 })
  }

  const { cid } = await resolveCid()
  const db = await getDb()

  // 先落库兜底,再尽力发信;失败不拦,状态记 failed 方便日后排查
  const id = db.addFeedback({ cid, message, contact, path, ua, ip })
  const ok = await sendFeedbackEmail({
    to: await feedbackTo(),
    from: feedbackFrom(),
    message,
    contact,
    path,
    ua,
    ip,
  })
  db.setFeedbackStatus(id, ok ? 'sent' : 'failed')

  return Response.json({ ok: true })
}