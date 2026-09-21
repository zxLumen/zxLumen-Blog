import Database from 'better-sqlite3'
import {
  SCHEMA_SQL,
  type ArchivedCommentRow,
  type CommentRow,
  type PagedArchived,
  type PagedComments,
  type UsageRow,
  type Visibility,
} from '../schema.js'
import { roundCny } from '../pricing.js'

export interface NewCommentInput {
  author: string
  author_link?: string
  body: string
  visibility?: Visibility
  parent_id?: number | null
  is_admin?: number
  ip?: string
  /** 访客匿名 ID(仅服务端使用,不下发前端),用于让作者看到自己的私密留言 */
  author_cid?: string
}

export interface NewUsageInput {
  ts?: string
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheHitTokens?: number
  source?: string
}

export interface Db {
  listPublicComments(limit?: number): CommentRow[]
  listAllComments(limit?: number): CommentRow[]
  listThreadPage(opts?: {
    page?: number
    pageSize?: number
    includePrivate?: boolean
    /** 访客匿名 ID:额外放行该访客自己的私密留言,并标记 mine */
    viewerCid?: string
    /** 返回 author_cid(仅站长接口使用) */
    withCid?: boolean
  }): PagedComments
  getComment(id: number): CommentRow | null
  /** 取某条留言的作者匿名 ID(仅服务端使用) */
  getCommentCid(id: number): string | null
  addComment(input: NewCommentInput): CommentRow
  /** 删除留言 = 归档整棵子树(admin/visitor 删除均可查回) */
  archiveComment(id: number, by: 'admin' | 'visitor'): boolean
  /** 从归档恢复整棵子树 */
  restoreComment(id: number): boolean
  /** 物理删除整棵子树(归档内彻底删除) */
  purgeComment(id: number): boolean
  /** 归档留言列表(仅站长接口) */
  listArchived(opts?: { page?: number; pageSize?: number }): PagedArchived
  listUsage(days?: number): UsageRow[]
  allUsage(): UsageRow[]
  addUsage(input: NewUsageInput): UsageRow
  countComments(): number
  clearComments(): number
  getMeta(key: string): string | null
  setMeta(key: string, value: string): void
  delMeta(key: string): void
  close(): void
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

const COMMENT_COLS = `id, author, author_link, body, visibility, parent_id, is_admin, created_at`
const COMMENT_COLS_CID = `id, author, author_link, body, visibility, parent_id, is_admin, author_cid, created_at`

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
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_cid ON comments(author_cid)')

  const mapUsage = (r: Record<string, unknown>): UsageRow => ({
    id: r.id as number,
    ts: r.ts as string,
    model: r.model as string,
    inputTokens: (r.input_tokens as number) ?? 0,
    outputTokens: (r.output_tokens as number) ?? 0,
    cacheHitTokens: (r.cache_hit_tokens as number) ?? 0,
    source: (r.source as string) ?? undefined,
  })

  return {
    listPublicComments(limit = 200) {
      return db
        .prepare(
          `SELECT ${COMMENT_COLS} FROM comments
           WHERE visibility='public' AND archived=0
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(limit) as CommentRow[]
    },

    listAllComments(limit = 500) {
      return db
        .prepare(
          `SELECT ${COMMENT_COLS} FROM comments
           WHERE archived=0
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(limit) as CommentRow[]
    },

    listThreadPage({
      page = 1,
      pageSize = 20,
      includePrivate = false,
      viewerCid = '',
      withCid = false,
    } = {}) {
      const size = Math.min(100, Math.max(1, Math.floor(pageSize)))
      // 站长看全部;访客看公开 + 自己发的私密;其余仅公开
      const mine = !includePrivate && !!viewerCid
      const vis = includePrivate
        ? ''
        : mine
          ? `AND (visibility='public' OR author_cid = ?)`
          : `AND visibility='public'`
      const visArgs = mine ? [viewerCid] : []
      // 已归档(=被删除)的留言不参与任何正常列表
      const rootWhere = `WHERE parent_id IS NULL ${vis}${vis ? ' AND' : 'AND'} archived=0`

      const total = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM comments ${rootWhere}`)
          .get(...visArgs) as { n: number }
      ).n
      const totalPages = Math.max(1, Math.ceil(total / size))
      const cur = Math.min(Math.max(1, Math.floor(page)), totalPages)
      const offset = (cur - 1) * size

      const rootIds = (
        db
          .prepare(
            `SELECT id FROM comments ${rootWhere}
             ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(...visArgs, size, offset) as { id: number }[]
      ).map((r) => r.id)

      if (rootIds.length === 0) {
        return { rows: [], total, page: cur, pageSize: size, totalPages }
      }

      const ph = rootIds.map(() => '?').join(',')
      // 需要 author_cid 时多取一列:站长接口原样返回,访客侧仅用于计算 mine 后剔除
      const cols = withCid || mine ? COMMENT_COLS_CID : COMMENT_COLS
      const raw = db
        .prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT id FROM comments WHERE id IN (${ph})
             UNION ALL
             SELECT c.id FROM comments c JOIN tree t ON c.parent_id = t.id
           )
           SELECT ${cols} FROM comments
           WHERE id IN (SELECT id FROM tree) ${vis} AND archived=0
           ORDER BY created_at ASC, id ASC`,
        )
        .all(...rootIds, ...visArgs) as (CommentRow & { author_cid?: string })[]

      let rows: CommentRow[] = raw
      if (mine) {
        // 标记"本人所发",并剔除 author_cid,避免泄露给前端
        rows = raw.map(({ author_cid, ...rest }) => ({ ...rest, mine: author_cid === viewerCid }))
      }

      return { rows, total, page: cur, pageSize: size, totalPages }
    },

    getComment(id) {
      const r = db.prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(id)
      return (r as CommentRow) ?? null
    },

    getCommentCid(id) {
      const r = db.prepare(`SELECT author_cid FROM comments WHERE id = ?`).get(id) as
        | { author_cid: string | null }
        | undefined
      return r ? (r.author_cid ?? '') : null
    },

    addComment(input) {
      const visibility: Visibility = input.visibility === 'private' ? 'private' : 'public'
      const created_at = nowIso()
      const parent_id = typeof input.parent_id === 'number' ? input.parent_id : null
      const info = db
        .prepare(
          `INSERT INTO comments (author, author_link, body, visibility, parent_id, is_admin, ip, author_cid, created_at)
           VALUES (@author, @author_link, @body, @visibility, @parent_id, @is_admin, @ip, @author_cid, @created_at)`,
        )
        .run({
          author: input.author,
          author_link: input.author_link ?? '',
          body: input.body,
          visibility,
          parent_id,
          is_admin: input.is_admin ? 1 : 0,
          ip: input.ip ?? '',
          author_cid: input.author_cid ?? '',
          created_at,
        })
      return {
        id: Number(info.lastInsertRowid),
        author: input.author,
        author_link: input.author_link ?? '',
        body: input.body,
        visibility,
        parent_id,
        is_admin: input.is_admin ? 1 : 0,
        created_at,
      }
    },

    archiveComment(id, by) {
      // 递归归档整棵子树(删除 = 移入归档,可查回/恢复)
      const info = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM comments WHERE id = @id
             UNION ALL
             SELECT c.id FROM comments c JOIN sub s ON c.parent_id = s.id
           )
           UPDATE comments
           SET archived = 1, archived_at = @at, archived_by = @by
           WHERE id IN (SELECT id FROM sub)`,
        )
        .run({ id, at: nowIso(), by })
      return info.changes > 0
    },

    restoreComment(id) {
      // 从归档恢复整棵子树(archived_at/by 还原为空)
      const info = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM comments WHERE id = @id
             UNION ALL
             SELECT c.id FROM comments c JOIN sub s ON c.parent_id = s.id
           )
           UPDATE comments
           SET archived = 0, archived_at = NULL, archived_by = ''
           WHERE id IN (SELECT id FROM sub)`,
        )
        .run({ id })
      return info.changes > 0
    },

    purgeComment(id) {
      // 物理删除整棵子树(含回复的回复),从归档彻底移除
      const info = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM comments WHERE id = @id
             UNION ALL
             SELECT c.id FROM comments c JOIN sub s ON c.parent_id = s.id
           )
           DELETE FROM comments WHERE archived=1 AND id IN (SELECT id FROM sub)`,
        )
        .run({ id })
      return info.changes > 0
    },

    listArchived({ page = 1, pageSize = 20 } = {}) {
      const size = Math.min(100, Math.max(1, Math.floor(pageSize)))
      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE archived=1`).get() as { n: number }
      ).n
      const totalPages = Math.max(1, Math.ceil(total / size))
      const cur = Math.min(Math.max(1, Math.floor(page)), totalPages)
      const offset = (cur - 1) * size
      const rows = db
        .prepare(
          `SELECT id, author, author_link, body, visibility, parent_id, is_admin, ip, author_cid, created_at, archived_at, archived_by
           FROM comments WHERE archived=1
           ORDER BY archived_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(size, offset) as ArchivedCommentRow[]
      return { rows, total, page: cur, pageSize: size, totalPages }
    },

    listUsage(days = 30) {
      const rows = db
        .prepare(`SELECT * FROM usage WHERE ts >= datetime('now', ?) ORDER BY ts DESC`)
        .all(`-${Math.max(1, days)} days`) as Record<string, unknown>[]
      return rows.map(mapUsage)
    },

    allUsage() {
      const rows = db.prepare(`SELECT * FROM usage ORDER BY ts DESC`).all() as Record<string, unknown>[]
      return rows.map(mapUsage)
    },

    addUsage(input) {
      const ts = input.ts ?? nowIso()
      const info = db
        .prepare(
          `INSERT INTO usage (ts, model, input_tokens, output_tokens, cache_hit_tokens, source)
           VALUES (@ts, @model, @input_tokens, @output_tokens, @cache_hit_tokens, @source)`,
        )
        .run({
          ts,
          model: input.model,
          input_tokens: input.inputTokens ?? 0,
          output_tokens: input.outputTokens ?? 0,
          cache_hit_tokens: input.cacheHitTokens ?? 0,
          source: input.source ?? 'report',
        })
      return {
        id: Number(info.lastInsertRowid),
        ts,
        model: input.model,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        cacheHitTokens: input.cacheHitTokens ?? 0,
        source: input.source ?? 'report',
      }
    },

    countComments() {
      return (db.prepare(`SELECT COUNT(*) AS n FROM comments`).get() as { n: number }).n
    },

    clearComments() {
      return db.prepare(`DELETE FROM comments`).run().changes
    },

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

    close() {
      db.close()
    },
  }
}

export { roundCny }
