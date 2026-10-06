import Database from 'better-sqlite3'
import { SCHEMA_SQL } from '../../schema.js'
import { chatStore } from './chat.js'
import { commentStore } from './comments.js'
import { aiUsageStore } from './ai-usage.js'
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
  // 本库是单机单文件单用户,WAL 带来的并发读收益为零,而它的代价是让已提交数据
  // 「住在旁路文件里」:一次提交先追加进 `-wal`,主库文件滞留在上次 checkpoint 的
  // 状态,靠后续 checkpoint 合并。
  //
  // 注意:**WAL 本身不会让已提交数据消失** —— 只要 `-wal` 还在,SQLite 就读得全;
  // 即使最后一个连接干净关闭触发 checkpoint + 删掉 `-wal`,那也是把内容并进主库,
  // 数据不丢(已提交的数据不是「只存在于 -wal」)。真正的杀手是**有人把旁路文件
  // 当临时文件处置**:`rm zx.db-wal`、用裸 `cp` 只拷主库(备份里就永远缺着没
  // checkpoint 的那部分)、或恢复时把旧 `-wal` 留在新主库旁边让它被回放。
  //
  // 2026-10-02 本地丢项目卡 = ① 乐观锁还没上时的整表覆盖把陈旧的 10 条写回
  // projects_config ② 备份用裸 cp、恢复时又删掉 -wal/-shm —— 叠加的结果。
  //
  // DELETE 模式下每次提交直接改主库文件,没有旁路文件可丢,最坏只丢最后一次事务。
  // 旧库首次打开时会自动从 WAL 转换过来并删除残留的 -wal/-shm。
  db.pragma('journal_mode = DELETE')
  db.pragma('busy_timeout = 30000')
  // DELETE 模式下 NORMAL 在断电/强杀时可能损坏数据库;写入量很小,换 FULL 更稳。
  db.pragma('synchronous = FULL')
  // pragma **返回实际生效的值且失败不抛错**:库在不支持的 FS / 库被锁 / 只读挂载时
  // 可能静默留在 WAL,而文档与 AGENTS.md 都写着 delete —— 那等于骗自己。所以设完
  // 立刻回读校验,对不上就启动失败(宁可起不来,也不要静默跑在一个没有旁路保护的库上)。
  const mode = String(db.pragma('journal_mode', { simple: true })).toLowerCase()
  // 内存库没有旁路文件可言,比 delete 更安全,单独放行(测试里有用)
  const ok = mode === 'delete' || (path === ':memory:' && mode === 'memory')
  if (!ok) {
    db.close()
    throw new Error(
      `journal_mode 期望 delete,实际 ${mode}:设置未生效(库被其他进程占用,或所在文件系统不支持)` +
        ` —— 已中止启动,避免在 WAL 模式下静默运行`,
    )
  }
  const sync = Number(db.pragma('synchronous', { simple: true }))
  if (sync !== 2) {
    db.close()
    throw new Error(`synchronous 期望 2(FULL),实际 ${sync}:设置未生效 —— 已中止启动`)
  }

  // 迁移:ai_usage 增加 hour 维度(PK 变更无法 ALTER → 重建;该表为新表,重建安全)
  const acols = (db.prepare('PRAGMA table_info(ai_usage)').all() as { name: string }[]).map((c) => c.name)
  if (acols.length > 0 && !acols.includes('hour')) db.exec('DROP TABLE ai_usage')

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
    ...aiUsageStore(db),
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
