import type { EventType, NewEventInput } from '@zx/shared'
import { isAdmin } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/db'
import { cidCookie, isMockActive, resolveCid } from '@/lib/clientid'

export const dynamic = 'force-dynamic'

const TYPES = new Set<EventType>(['visit', 'project_click', 'resume_download', 'leave', 'section_view', 'contact_click', 'vlog_play', 'app_click', 'app_impression'])
/** 常见爬虫/扫描器 UA(beacon 为 JS 触发,这里再兜一层) */
const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|headless|python-requests|curl|wget|go-http-client|axios|node-fetch/i

const empty = () => new Response(null, { status: 204 })

/**
 * 埋点写库/解析失败时的兜底日志。
 * 最多每秒 1 条,避免磁盘故障时把日志刷爆;不打印堆栈与 cookie,只留可检索的一行。
 */
let lastDropLog = 0
function logDrop(where: string, err: unknown): void {
  const now = Date.now()
  if (now - lastDropLog < 1000) return
  lastDropLog = now
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  console.warn(`[track] dropped (${where}): ${msg}`)
}

/**
 * 埋点写库队列:50 并发下每条 INSERT 都 fsync 会把单线程事件循环堵 ~1s,
 * Caddy 等不及就 reset 成 502。这里 5ms 内的写入合并成一个事务,先回 204。
 * 代价:进程崩溃最多丢 5ms/200 条以内的埋点(埋点本就可丢,页面不受影响)。
 */
type QueuedEvent = { input: NewEventInput; once: boolean }
const QUEUE_LIMIT = 200
const queue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(flushQueue, 5)
  // 不因一个待写批次阻止进程退出
  flushTimer.unref?.()
}

function flushQueue(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  const normal: NewEventInput[] = []
  const once: NewEventInput[] = []
  for (const item of batch) (item.once ? once : normal).push(item.input)
  try {
    const db = getDb()
    if (normal.length > 0) db.addEvents(normal)
    if (once.length > 0) db.addEventsOnce(once)
  } catch (err) {
    // 整批失败只丢这一批埋点,不影响任何客户端(它们早已拿到 204)
    logDrop('db', err)
  }
  if (queue.length > 0) scheduleFlush()
}

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
 * 埋点上报:访问 / 离开 / 区块浏览 / 项目点击 / 简历下载 / 联系点击 / 视频播放。
 * 站长、MOCK、爬虫不计入(开启 MOCK 时按 mock 身份计入)。
 * 说明:采集**始终开启**(匿名聚合),是否对外展示由功能门控 `visitor-stats` 决定
 * (见 StatsSection)。这样放行前也能积累历史数据。
 */
export async function POST(req: Request) {
  // 埋点是 fire-and-forget 的旁路链路:任何异常都不能变成 5xx 反噬页面。
  try {
    return await handleTrack(req)
  } catch (err) {
    logDrop('unhandled', err)
    return empty()
  }
}

async function handleTrack(req: Request): Promise<Response> {
  // Caddy/浏览器已断开时不再做无意义的工作
  if (req.signal.aborted) return empty()
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
  let session = ''
  let pos = -1
  try {
    const j = JSON.parse(await req.text()) as {
      type?: string
      target?: string
      ref?: string
      dwell?: number
      session?: string
      pos?: number
    }
    if (j.type && TYPES.has(j.type as EventType)) type = j.type as EventType
    target = String(j.target ?? '').slice(0, 200)
    referrer = String(j.ref ?? '').slice(0, 200)
    if (type === 'leave' || type === 'section_view' || type === 'app_impression') {
      dwell = Math.max(0, Math.min(86400, Math.round(Number(j.dwell) || 0)))
    }
    // 会话 ID 只收客户端固定形态(8–64 位小写字母/数字/连字符),非法值丢弃
    const sid = typeof j.session === 'string' ? j.session.trim() : ''
    if (/^[a-z0-9-]{8,64}$/i.test(sid)) session = sid
    // 卡片位置只对曝光有意义;非法/越界一律 -1
    const p = j.pos
    if (type === 'app_impression' && typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < 1000) {
      pos = p
    }
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
  const payload = { type, target, cid, ua: ua.slice(0, 200), referrer, dwell, session, pos }
  // 解析/鉴权期间客户端可能已经断开:有效事件照写,断开的连接不再占着写库
  if (req.signal.aborted) return empty()
  // 入队后立刻回 204:真正的写库由 5ms 微批事务完成,避免 fsync 堵住事件循环
  queue.push({ input: payload, once: type === 'vlog_play' && target !== '' })
  if (queue.length >= QUEUE_LIMIT) flushQueue()
  else scheduleFlush()

  const res = empty()
  if (isNew) res.headers.append('Set-Cookie', cidCookie(cid))
  return res
}
