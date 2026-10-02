import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../../schema.js'
import { chatStore } from './chat.js'
import { commentStore } from './comments.js'
import { eventStore } from './events.js'
import { feedbackStore } from './feedback.js'
import { kbStore } from './kb.js'
import { metaStore } from './meta.js'
import { statsStore } from './stats.js'
import { usageStore } from './usage.js'
import { visitorStore } from './visitors.js'
import type { Db } from './types.js'

/** 打开(必要时创建)SQLite 数据库并初始化 schema + 轻量迁移 */
export function openDb(path: string): Db {
  const db = new Database(path)
  // journal_mode 必须是 DELETE(默认),**不要**改回 WAL。
  //
  // 本库是单机单文件单用户,WAL 带来的并发读收益为零,却引入了一个致命故障:
  // WAL 模式下「已提交」只代表写进了 `-wal`,主库文件可能还是旧值。此时若
  // `-wal` 被丢弃(第二进程打开后干净关闭会 checkpoint+删掉 WAL、dev server
  // 重启、手滑 `rm zx.db-wal`),SQLite 就回退到上次 checkpoint 的状态 ——
  // **整库静默回滚**,没有任何 API 调用记录,查不到人。
  // (2026-10-02 本地项目卡就是这么丢的:12 项只存在于 -wal,主库文件里还是 10 项。)
  //
  // DELETE 模式下每次提交直接改主库文件,不存在「已提交但只在旁路文件里」的
  // 幽灵状态;最坏情况只丢最后一次事务。旧库首次打开时会自动从 WAL 转换过来
  // 并删除残留的 -wal/-shm。
  db.pragma('journal_mode = DELETE')
  db.pragma('busy_timeout = 30000')
  // DELETE 模式下 NORMAL 在断电/强杀时可能损坏数据库;写入量很小,换 FULL 更稳。
  db.pragma('synchronous = FULL')
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
  // addEventOnce 的去重查重走这个索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_dedup ON events(type, cid, day, target)')

  return {
    ...commentStore(db),
    ...usageStore(db),
    ...eventStore(db),
    ...feedbackStore(db),
    ...statsStore(db),
    ...metaStore(db),
    ...visitorStore(db),
    ...chatStore(db),
    ...kbStore(db),
    close() {
      db.close()
    },
  }
}
