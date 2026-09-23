import type { EventType } from '@zx/shared'
import { isAdmin } from '@/lib/auth'
import { getActiveDb } from '@/lib/env'
import { clientIp, rateLimit } from '@/lib/db'
import { cidCookie, isMockActive, resolveCid } from '@/lib/clientid'

export const dynamic = 'force-dynamic'

const TYPES = new Set<EventType>(['visit', 'project_click', 'resume_download'])
/** 常见爬虫/扫描器 UA(beacon 为 JS 触发,这里再兜一层) */
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|headless|python-requests|curl|wget|go-http-client|axios|node-fetch/i

const empty = () => new Response(null, { status: 204 })

/**
 * 埋点上报:访问 / 项目点击 / 简历下载。站长、MOCK、爬虫不计入。
 * 说明:采集**始终开启**(匿名聚合),是否对外展示由功能门控 `visitor-stats` 决定
 * (见 StatsSection)。这样放行前也能积累历史数据。
 */
export async function POST(req: Request) {
  const ip = clientIp(req)
  // 宽松限流;超限静默丢弃
  if (!rateLimit(`track:${ip}`, 120)) return empty()
  const ua = req.headers.get('user-agent') ?? ''
  if (BOT_RE.test(ua)) return empty()
  // 站长本人不计入;但测试模式下开启 MOCK(=以某匿名访客身份浏览)时放行,
  // 便于在测试库里验收 多身份 PV/UV/点击 等统计链路(仅测试模式 + 站长可设 mock)。
  const mocking = await isMockActive()
  if (!mocking && (await isAdmin())) return empty()

  let type: EventType = 'visit'
  let target = ''
  let referrer = ''
  try {
    const j = JSON.parse(await req.text()) as { type?: string; target?: string; ref?: string }
    if (j.type && TYPES.has(j.type as EventType)) type = j.type as EventType
    target = String(j.target ?? '').slice(0, 200)
    referrer = String(j.ref ?? '').slice(0, 200)
  } catch {
    /* 空/非法 body 视为 visit */
  }

  const { cid, isNew } = await resolveCid()
  ;(await getActiveDb()).addEvent({ type, target, cid, ua: ua.slice(0, 200), referrer })

  const res = empty()
  if (isNew) res.headers.append('Set-Cookie', cidCookie(cid))
  return res
}
