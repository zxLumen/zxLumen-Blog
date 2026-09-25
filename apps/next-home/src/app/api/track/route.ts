import type { EventType } from '@zx/shared'
import { isAdmin } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/db'
import { cidCookie, isMockActive, resolveCid } from '@/lib/clientid'

export const dynamic = 'force-dynamic'

const TYPES = new Set<EventType>(['visit', 'project_click', 'resume_download', 'leave', 'section_view', 'contact_click'])
/** 常见爬虫/扫描器 UA(beacon 为 JS 触发,这里再兜一层) */
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|headless|python-requests|curl|wget|go-http-client|axios|node-fetch/i

const empty = () => new Response(null, { status: 204 })

/** 防抖:同一 cid+type+target 在窗口内重复上报只记一次(防手抖双击 / sendBeacon 重试) */
const DEDUP_MS = 2000
const recent = new Map<string, number>()
function isDuplicate(key: string): boolean {
  const now = Date.now()
  // 顺手清理过期项,避免 map 无限增长
  for (const [k, t] of recent) if (now - t > DEDUP_MS) recent.delete(k)
  const prev = recent.get(key)
  if (prev != null && now - prev < DEDUP_MS) return true
  recent.set(key, now)
  return false
}

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
  // 站长本人不计入;但开启 MOCK(=以某匿名访客身份浏览)时放行,
  // 便于验收 多身份 PV/UV/点击 等统计链路(仅站长可设 mock)。
  const mocking = await isMockActive()
  if (!mocking && (await isAdmin())) return empty()

  let type: EventType = 'visit'
  let target = ''
  let referrer = ''
  let dwell = 0
  try {
    const j = JSON.parse(await req.text()) as { type?: string; target?: string; ref?: string; dwell?: number }
    if (j.type && TYPES.has(j.type as EventType)) type = j.type as EventType
    target = String(j.target ?? '').slice(0, 200)
    referrer = String(j.ref ?? '').slice(0, 200)
    dwell = type === 'leave' || type === 'section_view' ? Math.max(0, Math.min(86400, Math.round(Number(j.dwell) || 0))) : 0
  } catch {
    /* 空/非法 body 视为 visit */
  }

  const { cid, isNew } = await resolveCid()
  // 同一访客短时间内重复点击同一目标(手抖双击 / 广播重试)只记一次;visit/leave 不防抖
  if (type !== 'visit' && type !== 'leave' && isDuplicate(`${cid}|${type}|${target}`)) {
    const dup = empty()
    if (isNew) dup.headers.append('Set-Cookie', cidCookie(cid))
    return dup
  }
  ;(await getDb()).addEvent({ type, target, cid, ua: ua.slice(0, 200), referrer, dwell })

  const res = empty()
  if (isNew) res.headers.append('Set-Cookie', cidCookie(cid))
  return res
}
