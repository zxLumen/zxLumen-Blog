import { getContactSettings } from '@/lib/settings'
import { rateLimit, clientIp } from '@/lib/db'

export const dynamic = 'force-dynamic'

// 电话不预置到页面;点击「电话」时才获取(限流防批量抓取)
export async function GET(req: Request) {
  if (!rateLimit(clientIp(req), 20)) {
    return Response.json({ error: 'too many requests' }, { status: 429 })
  }
  return Response.json({ phone: getContactSettings().phone || '' })
}
