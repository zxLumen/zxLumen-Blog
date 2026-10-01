/** 访客反馈邮件:走 Resend HTTP API(与服务器邮件服务出站同一家中继,域名已验)。
 *  没有 RESEND_API_KEY 时直接返回 false(反馈已入库兜底,不报错)。 */

const RESEND_URL = 'https://api.resend.com/emails'

interface FeedbackMail {
  to: string
  from: string
  message: string
  contact?: string
  path?: string
  ua?: string
  ip?: string
}

/** 发件地址:FEEDBACK_FROM 优先;否则按 DOMAIN 推导;再兜底本站域名 */
export function feedbackFrom(): string {
  const env = process.env.FEEDBACK_FROM
  if (env) return env
  const domain = process.env.DOMAIN || 'zxlumen.cn'
  return `feedback@${domain}`
}

export async function sendFeedbackEmail(opts: FeedbackMail): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false

  const lines = [
    `时间:${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `页面:${opts.path || '/'}`,
    opts.contact ? `联系方式:${opts.contact}` : `联系方式:(未填)`,
    `UA:${(opts.ua || '').slice(0, 300)}`,
    opts.ip ? `IP:${opts.ip}` : '',
    '',
    '----- 反馈内容 -----',
    '',
    opts.message,
  ]
  const subject = `[站点反馈] ${opts.message.replace(/\s+/g, ' ').slice(0, 30)}`

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from,
        to: opts.to,
        subject,
        text: lines.join('\n'),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}