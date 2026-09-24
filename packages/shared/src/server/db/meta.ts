import type { MetaStore, SqliteDb } from './types.js'

export function metaStore(db: SqliteDb): MetaStore {
  return {
    getMeta(key) {
      const r = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
        | { value: string }
        | undefined
      return r?.value ?? null
    },

    setMeta(key, value) {
      db.prepare(
        `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      ).run(key, value)
    },

    delMeta(key) {
      db.prepare(`DELETE FROM meta WHERE key = ?`).run(key)
    },
  }
}
