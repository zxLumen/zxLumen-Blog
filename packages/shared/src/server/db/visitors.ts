import type { VisitorAlias } from '../../schema.js'
import type { SqliteDb, VisitorStore } from './types.js'

/** 站长给访客起的别名/备注(仅 admin 可见;不属于访客自己填的资料) */
export function visitorStore(db: SqliteDb): VisitorStore {
  return {
    getVisitorAlias(cid) {
      if (!cid) return null
      const r = db.prepare(`SELECT cid, alias, updated_at FROM visitor_aliases WHERE cid = ?`).get(cid) as
        | VisitorAlias
        | undefined
      return r ?? null
    },

    listVisitorAliases() {
      return db
        .prepare(
          `SELECT cid, alias, updated_at FROM visitor_aliases WHERE alias != '' ORDER BY updated_at DESC`,
        )
        .all() as VisitorAlias[]
    },

    /** 写入备注;alias 去空白后为空 = 清除备注(直接删行) */
    setVisitorAlias(cid, alias) {
      const a = alias.trim()
      if (!a) {
        db.prepare(`DELETE FROM visitor_aliases WHERE cid = ?`).run(cid)
        return null
      }
      db.prepare(
        `INSERT INTO visitor_aliases(cid, alias, updated_at) VALUES(?, ?, datetime('now'))
         ON CONFLICT(cid) DO UPDATE SET alias=excluded.alias, updated_at=excluded.updated_at`,
      ).run(cid, a)
      const r = db
        .prepare(`SELECT cid, alias, updated_at FROM visitor_aliases WHERE cid = ?`)
        .get(cid) as VisitorAlias
      return r
    },
  }
}