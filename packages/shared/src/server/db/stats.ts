import type { DayPoint, EventType, StatsResult, VisitorDetail } from '../../schema.js'
import { bjDay, bjTime, bjTimeSec, tsMs } from '../../time.js'
import type { SqliteDb, StatsStore } from './types.js'

/** 会话切分阈值:相邻事件间隔超过 30 分钟视为新会话 */
const SESSION_GAP_MS = 30 * 60 * 1000

/** 访客明细「最近操作」保留的最大条数 */
const RECENT_MAX = 30

/**
 * 构造访客明细的「最近操作」流水(时间倒序)。
 * - **保留全部事件**(visit / project_click / resume_download / section_view / leave);
 * - **连续去重**:相邻两条若 type 与 target 都相同,只留一条(如连续多次 `访问 /`);
 * - 只取最近 RECENT_MAX 条。
 */
function buildRecent(
  rows: { ts: string; type: EventType; target: string; dwell?: number }[],
): { ts: string; type: EventType; target: string; dwell?: number }[] {
  const out: { ts: string; type: EventType; target: string; dwell?: number }[] = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const cur = rows[i]
    const prev = out[out.length - 1]
    if (prev && prev.type === cur.type && prev.target === cur.target) continue
    out.push(cur)
    if (out.length >= RECENT_MAX) break
  }
  return out.map((e) => ({
    ts: bjTimeSec(e.ts),
    type: e.type,
    target: e.target,
    ...(e.type === 'leave' && e.dwell ? { dwell: e.dwell } : {}),
  }))
}

/**
 * 从按时间升序的事件里计算会话数与平均时长(秒)。
 *
 * 会话时长优先用 `leave` 事件的 `dwell`(前台可见停留秒数)求和;
 * 若该会话没有任何 dwell(老数据 / 未触发离开上报),回退为「首末事件间隔」估算。
 */
function computeSessions(rows: { ts: string; type?: string; dwell?: number }[]) {
  let count = 0
  let totalMs = 0
  let sessStartMs = 0
  let sessDwell = 0
  let prevMs = 0

  const flush = () => {
    // 有 dwell 用真实停留;否则用首末事件跨度
    totalMs += sessDwell > 0 ? sessDwell * 1000 : Math.max(0, prevMs - sessStartMs)
  }

  for (const row of rows) {
    const ms = tsMs(row.ts)
    if (prevMs === 0 || ms - prevMs > SESSION_GAP_MS) {
      if (prevMs > 0) flush()
      count++
      sessStartMs = ms
      sessDwell = 0
    }
    if (row.type === 'leave') sessDwell += Math.max(0, Number(row.dwell) || 0)
    prevMs = ms
  }
  if (prevMs > 0) flush()
  return { count, avgSec: count ? Math.round(totalMs / count / 1000) : 0 }
}

/** 从 UA 解析 "系统 · 浏览器 · 终端" 描述(够用即可,不上解析库) */
function parseDevice(ua = '') {
  let type = '桌面'
  if (/iPad|Tablet/i.test(ua)) type = '平板'
  else if (/Mobi|iPhone|Android/i.test(ua)) type = '手机'
  let os = '其他系统'
  if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Mac OS|Macintosh/i.test(ua)) os = 'macOS'
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Linux/i.test(ua)) os = 'Linux'
  let browser = '其他浏览器'
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera'
  else if (/Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  else if (/Safari\//i.test(ua)) browser = 'Safari'
  return `${os} · ${browser} · ${type}`
}

export function statsStore(db: SqliteDb): StatsStore {
  return {
    stats({ trendDays = 30, onlineMinutes = 5, visitors: wantVisitors = false } = {}) {
      const today = bjDay()
      const n = (sql: string, ...args: unknown[]) =>
        (db.prepare(sql).get(...args) as { n: number }).n

      const pv = n(`SELECT COUNT(*) AS n FROM events WHERE type='visit'`)
      const uv = n(`SELECT COUNT(DISTINCT cid) AS n FROM events WHERE type='visit' AND cid != ''`)
      const todayPv = n(`SELECT COUNT(*) AS n FROM events WHERE type='visit' AND day = ?`, today)
      const todayUv = n(
        `SELECT COUNT(DISTINCT cid) AS n FROM events WHERE type='visit' AND cid != '' AND day = ?`,
        today,
      )
      const online = n(
        `SELECT COUNT(DISTINCT cid) AS n FROM events WHERE type='visit' AND cid != '' AND ts >= datetime('now', ?)`,
        `-${onlineMinutes} minutes`,
      )

      const trendRows = db
        .prepare(
          `SELECT day, COUNT(*) AS pv, COUNT(DISTINCT cid) AS uv
           FROM events WHERE type='visit' AND day >= ? GROUP BY day`,
        )
        .all(bjDay(Date.now() - (trendDays - 1) * 86400000)) as { day: string; pv: number; uv: number }[]
      const tmap = new Map(trendRows.map((r) => [r.day, r]))
      const days: DayPoint[] = []
      for (let i = trendDays - 1; i >= 0; i--) {
        const d = bjDay(Date.now() - i * 86400000)
        const r = tmap.get(d)
        days.push({ day: d, pv: r?.pv ?? 0, uv: r?.uv ?? 0 })
      }

      const comments = {
        total: n(`SELECT COUNT(*) AS n FROM comments WHERE archived=0`),
        today: n(`SELECT COUNT(*) AS n FROM comments WHERE archived=0 AND date(created_at, '+8 hours') = ?`, today),
        publicCount: n(`SELECT COUNT(*) AS n FROM comments WHERE archived=0 AND visibility='public'`),
        privateCount: n(`SELECT COUNT(*) AS n FROM comments WHERE archived=0 AND visibility='private'`),
        authors: n(`SELECT COUNT(DISTINCT author) AS n FROM comments WHERE archived=0`),
      }

      const clickRows = db
        .prepare(
          `SELECT target, COUNT(*) AS count FROM events
           WHERE type='project_click' AND target != '' GROUP BY target`,
        )
        .all() as { target: string; count: number }[]
      const clicksByTarget: Record<string, number> = {}
      for (const r of clickRows) clicksByTarget[r.target] = r.count

      const contactRows = db
        .prepare(
          `SELECT target, COUNT(*) AS count FROM events
           WHERE type='contact_click' AND target != '' GROUP BY target`,
        )
        .all() as { target: string; count: number }[]
      const contactsByTarget: Record<string, number> = {}
      for (const r of contactRows) contactsByTarget[r.target] = r.count

      const events = {
        projectClicks: n(`SELECT COUNT(*) AS n FROM events WHERE type='project_click'`),
        resumeDownloads: n(`SELECT COUNT(*) AS n FROM events WHERE type='resume_download'`),
        clicksByTarget,
        contactClicks: n(`SELECT COUNT(*) AS n FROM events WHERE type='contact_click'`),
        contactsByTarget,
      }

      // ---- 访客访问详情(最近活跃的 30 位;仅 opts.visitors 时计算) ----
      let visitors: VisitorDetail[] = []
      if (wantVisitors) {
        const visitorRows = db
          .prepare(
            `SELECT cid,
                    SUM(CASE WHEN type='visit' THEN 1 ELSE 0 END) AS visits,
                    SUM(CASE WHEN type='resume_download' THEN 1 ELSE 0 END) AS resumeDownloads,
                    MAX(ts) AS lastTs
               FROM events WHERE cid != '' GROUP BY cid ORDER BY lastTs DESC LIMIT 30`,
          )
          .all() as { cid: string; visits: number; resumeDownloads: number; lastTs: string }[]

        const nickRows = db
          .prepare(
            `SELECT author_cid, author FROM comments WHERE archived=0 AND author_cid != '' ORDER BY id DESC`,
          )
          .all() as { author_cid: string; author: string }[]
        const nickMap = new Map<string, string>()
        for (const r of nickRows) if (!nickMap.has(r.author_cid)) nickMap.set(r.author_cid, r.author)

        // 回头客判定:访问日 ≥ 2 天(即在不同日期访问过,视为回访;单日多次仍算新客)
        const visitDayRows = db
          .prepare(
            `SELECT cid, COUNT(DISTINCT day) AS dayCount
               FROM events WHERE cid != '' AND type='visit' GROUP BY cid`,
          )
          .all() as { cid: string; dayCount: number }[]
        const visitDays = new Map<string, number>()
        for (const r of visitDayRows) visitDays.set(r.cid, r.dayCount)

        const ccRows = db
          .prepare(
            `SELECT author_cid, COUNT(*) AS n FROM comments WHERE archived=0 AND author_cid != '' GROUP BY author_cid`,
          )
          .all() as { author_cid: string; n: number }[]
        const ccMap = new Map(ccRows.map((r) => [r.author_cid, r.n]))

        const clickByCidRows = db
          .prepare(
            `SELECT cid, target, COUNT(*) AS n FROM events
              WHERE cid != '' AND type='project_click' AND target != '' GROUP BY cid, target`,
          )
          .all() as { cid: string; target: string; n: number }[]
        const clickByCid = new Map<string, Record<string, number>>()
        for (const r of clickByCidRows) {
          const m = clickByCid.get(r.cid) ?? {}
          m[r.target] = r.n
          clickByCid.set(r.cid, m)
        }

        const histStmt = db.prepare(
          `SELECT ts, type, target, referrer, ua, dwell FROM events
            WHERE cid = ? ORDER BY ts ASC, id ASC LIMIT 500`,
        )

        visitors = visitorRows.map((r) => {
          const hist = histStmt.all(r.cid) as {
            ts: string
            type: EventType
            target: string
            referrer: string
            ua: string
            dwell: number
          }[]
          const { count: sessions, avgSec } = computeSessions(hist)
          let referrer = ''
          for (const h of hist) if (!referrer && h.referrer) referrer = h.referrer
          return {
            cid: r.cid,
            nickname: nickMap.get(r.cid) ?? '',
            lastSeen: bjTime(r.lastTs),
            firstSeen: bjTime(hist[0]?.ts ?? r.lastTs),
            returning: (visitDays.get(r.cid) ?? 0) >= 2,
            device: parseDevice(hist[hist.length - 1]?.ua ?? ''),
            sessions,
            avgSessionSec: avgSec,
            referrer,
            visits: r.visits,
            resumeDownloads: r.resumeDownloads,
            commentCount: ccMap.get(r.cid) ?? 0,
            projectClicks: clickByCid.get(r.cid) ?? {},
            recent: buildRecent(hist),
          }
        })
      }

      return {
        visits: { pv, uv, today: { pv: todayPv, uv: todayUv }, online, days },
        comments,
        events,
        visitors,
      }
    },
  }
}
