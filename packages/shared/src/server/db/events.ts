import type { NewEventInput } from '../../schema.js'
import { nowIso, bjDay } from '../../time.js'
import type { EventStore, SqliteDb } from './types.js'

export function eventStore(db: SqliteDb): EventStore {
  return {
    addEvent(input: NewEventInput) {
      db.prepare(
        `INSERT INTO events (ts, day, cid, type, target, ua, referrer, dwell)
         VALUES (@ts, @day, @cid, @type, @target, @ua, @referrer, @dwell)`,
      ).run({
        ts: nowIso(),
        day: bjDay(),
        cid: input.cid ?? '',
        type: input.type,
        target: input.target ?? '',
        ua: input.ua ?? '',
        referrer: input.referrer ?? '',
        dwell: Math.max(0, Math.round(Number(input.dwell) || 0)),
      })
    },
  }
}
