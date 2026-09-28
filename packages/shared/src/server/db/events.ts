import type { NewEventInput } from '../../schema.js'
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
  })

  return {
    addEvent(input: NewEventInput) {
      db.prepare(
        `INSERT INTO events (ts, day, cid, type, target, ua, referrer, dwell)
         VALUES (@ts, @day, @cid, @type, @target, @ua, @referrer, @dwell)`,
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
          `INSERT INTO events (ts, day, cid, type, target, ua, referrer, dwell)
           SELECT @ts, @day, @cid, @type, @target, @ua, @referrer, @dwell
           WHERE NOT EXISTS (
             SELECT 1 FROM events
             WHERE type=@type AND cid=@cid AND day=@day AND target=@target
           )`,
        )
        .run(params(input))
      return info.changes > 0
    },
  }
}
