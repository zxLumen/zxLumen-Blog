import type { AppFunnelRow, NewEventInput, ViewerAppRow } from '../../schema.js'
import { nowIso, bjDay } from '../../time.js'
import type { EventStore, SqliteDb } from './types.js'

export function eventStore(db: SqliteDb): EventStore {
  /** 组装写入参数(两个写入方法共用) */
  const params = (input: NewEventInput) => ({
    ts: nowIso(),
    day: bjDay(),
    cid: input.cid ?? '',
    type: input.type,
    target: input.target ?? '',
    ua: input.ua ?? '',
    referrer: input.referrer ?? '',
    dwell: Math.max(0, Math.round(Number(input.dwell) || 0)),
    session: input.session ?? '',
    pos: Number.isFinite(Number(input.pos)) ? Math.max(-1, Math.round(Number(input.pos))) : -1,
  })

  return {
    addEvent(input: NewEventInput) {
      db.prepare(
        `INSERT INTO events (ts, day, cid, type, target, ua, referrer, dwell, session, pos)
         VALUES (@ts, @day, @cid, @type, @target, @ua, @referrer, @dwell, @session, @pos)`,
      ).run(params(input))
    },

    /**
     * 去重写入:同一 `(cid, day, type, target)` 已存在则不写,返回是否真的写入。
     * 用 `INSERT ... SELECT ... WHERE NOT EXISTS` 单条 SQL 完成,天然抗并发重复
     * (不存在「先查后插」的竞态窗口)。用于视频播放:每人每天每集只记一次。
     */
    addEventOnce(input: NewEventInput) {
      const info = db
        .prepare(
          `INSERT INTO events (ts, day, cid, type, target, ua, referrer, dwell, session, pos)
           SELECT @ts, @day, @cid, @type, @target, @ua, @referrer, @dwell, @session, @pos
           WHERE NOT EXISTS (
             SELECT 1 FROM events
             WHERE type=@type AND cid=@cid AND day=@day AND target=@target
           )`,
        )
        .run(params(input))
      return info.changes > 0
    },

    /**
     * 应用卡片漏斗(应用流 /apps 的排序依据)。
     *
     * - impression:`app_impression` 且 dwell=0(客户端每卡每次挂载只报一次)
     * - s3:同目标 dwell≥3 的条数(曝光 3 秒后仍可见)
     * - click:`app_click` / `project_click` / `contact_click` 命中 target
     * - r7:点过该应用的人里,7 天内有第二次点击日的占比(按 cid 去重)
     *
     * 全表扫描按 (type, day) 走不了索引也够快:events 是单机小表,页面 60 秒缓存一次。
     */
    appFunnel(days = 7): AppFunnelRow[] {
      const since = bjDay(Date.now() - Math.max(0, days - 1) * 86400_000)
      const impressions = new Map<string, number>()
      const s3 = new Map<string, number>()
      const clicks = new Map<string, number>()
      const cidDays = new Map<string, Map<string, Set<string>>>()

      const impRows = db
        .prepare(
          `SELECT target, dwell, COUNT(*) AS n FROM events
           WHERE type = 'app_impression' AND day >= ?
           GROUP BY target, dwell`,
        )
        .all(since) as { target: string; dwell: number; n: number }[]
      for (const r of impRows) {
        if (!r.target) continue
        if (r.dwell >= 3) s3.set(r.target, (s3.get(r.target) ?? 0) + r.n)
        else if (r.dwell === 0) impressions.set(r.target, (impressions.get(r.target) ?? 0) + r.n)
      }

      const clickRows = db
        .prepare(
          `SELECT target, cid, day FROM events
           WHERE type IN ('app_click', 'project_click', 'contact_click')
             AND day >= ? AND target <> ''`,
        )
        .all(since) as { target: string; cid: string; day: string }[]
      for (const r of clickRows) {
        clicks.set(r.target, (clicks.get(r.target) ?? 0) + 1)
        if (!r.cid) continue
        let byDay = cidDays.get(r.target)
        if (!byDay) cidDays.set(r.target, (byDay = new Map()))
        let set = byDay.get(r.cid)
        if (!set) byDay.set(r.cid, (set = new Set()))
        set.add(r.day)
      }

      const targets = new Set([...impressions.keys(), ...clicks.keys()])
      const out: AppFunnelRow[] = []
      for (const target of targets) {
        const imp = impressions.get(target) ?? 0
        const ck = clicks.get(target) ?? 0
        const s3n = s3.get(target) ?? 0
        const byCid = cidDays.get(target)
        let repeats = 0
        if (byCid) {
          for (const set of byCid.values()) {
            if (set.size < 2) continue
            const list = [...set].sort()
            for (let i = 1; i < list.length; i++) {
              const gap =
                (Date.parse(`${list[i]}T00:00:00Z`) - Date.parse(`${list[i - 1]}T00:00:00Z`)) / 86400_000
              if (gap >= 1 && gap <= 7) {
                repeats++
                break
              }
            }
          }
        }
        out.push({
          target,
          impressions: imp,
          s3: s3n,
          clicks: ck,
          ctr: imp > 0 ? ck / imp : 0,
          s3Rate: imp > 0 ? s3n / imp : 0,
          r7: byCid && byCid.size > 0 ? repeats / byCid.size : 0,
        })
      }
      return out
    },

    /** 某访客最近 days 天点开过哪些应用(「上次 N 天前」+ 探索位) */
    viewerAppHistory(cid: string, days = 30): ViewerAppRow[] {
      if (!cid) return []
      const since = bjDay(Date.now() - Math.max(0, days - 1) * 86400_000)
      return db
        .prepare(
          `SELECT target, COUNT(*) AS opens, MAX(day) AS lastDay FROM events
           WHERE type IN ('app_click', 'project_click', 'contact_click') AND cid = ? AND day >= ?
           GROUP BY target`,
        )
        .all(cid, since) as ViewerAppRow[]
    },
  }
}
