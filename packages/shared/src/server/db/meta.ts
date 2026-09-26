import type { MetaStore, SqliteDb } from './types.js'

/** 元键模糊查询:`prefix` 里的 `%` / `_` / `\` 会被转义,按字面前缀匹配 */
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

    listMetaKeys(prefix) {
      const rows = db
        .prepare(
          `SELECT key FROM meta WHERE key LIKE ? ESCAPE '\\' ORDER BY key`,
        )
        .all(`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as { key: string }[]
      return rows.map((r) => r.key)
    },
  }
}
