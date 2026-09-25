import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../../schema.js'
import { chatStore } from './chat.js'
import { commentStore } from './comments.js'
import { eventStore } from './events.js'
import { kbStore } from './kb.js'
import { metaStore } from './meta.js'
import { statsStore } from './stats.js'
import { usageStore } from './usage.js'
import type { Db } from './types.js'

/** 打开(必要时创建)SQLite 数据库并初始化 schema + 轻量迁移 */
export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 30000')
  db.pragma('synchronous = NORMAL')
  db.exec(SCHEMA_SQL)

  // 迁移:老库补列
  const cols = new Set(
    (db.prepare('PRAGMA table_info(comments)').all() as { name: string }[]).map((c) => c.name),
  )
  if (!cols.has('parent_id')) db.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER DEFAULT NULL')
  if (!cols.has('is_admin')) db.exec('ALTER TABLE comments ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
  if (!cols.has('author_cid')) db.exec("ALTER TABLE comments ADD COLUMN author_cid TEXT DEFAULT ''")
  if (!cols.has('archived')) db.exec("ALTER TABLE comments ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
  if (!cols.has('archived_at')) db.exec("ALTER TABLE comments ADD COLUMN archived_at TEXT")
  if (!cols.has('archived_by')) db.exec("ALTER TABLE comments ADD COLUMN archived_by TEXT DEFAULT ''")
  if (!cols.has('archived_by_cid'))
    db.exec("ALTER TABLE comments ADD COLUMN archived_by_cid TEXT DEFAULT ''")
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_cid ON comments(author_cid)')

  // 迁移:events 表补 referrer / dwell 列
  const ecols = new Set(
    (db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map((c) => c.name),
  )
  if (!ecols.has('referrer')) db.exec("ALTER TABLE events ADD COLUMN referrer TEXT DEFAULT ''")
  if (!ecols.has('dwell')) db.exec('ALTER TABLE events ADD COLUMN dwell INTEGER DEFAULT 0')

  return {
    ...commentStore(db),
    ...usageStore(db),
    ...eventStore(db),
    ...statsStore(db),
    ...metaStore(db),
    ...chatStore(db),
    ...kbStore(db),
    close() {
      db.close()
    },
  }
}
