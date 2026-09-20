import Database from 'better-sqlite3'
import {
  SCHEMA_SQL,
  type CommentRow,
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
    /** 访客匿名 ID:额外放行该访客自己的私密留言 */
    viewerCid?: string
  }): PagedComments
  getComment(id: number): CommentRow | null
  addComment(input: NewCommentInput): CommentRow
  deleteComment(id: number): boolean
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
           WHERE visibility='public'
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(limit) as CommentRow[]
    },

    listAllComments(limit = 500) {
      return db
        .prepare(
          `SELECT ${COMMENT_COLS} FROM comments
           ORDER BY created_at ASC, id ASC LIMIT ?`,
        )
        .all(limit) as CommentRow[]
    },

    listThreadPage({ page = 1, pageSize = 20, includePrivate = false, viewerCid = '' } = {}) {
      const size = Math.min(100, Math.max(1, Math.floor(pageSize)))
      // 站长看全部;访客看公开 + 自己发的私密;其余仅公开
      const mine = !includePrivate && !!viewerCid
      const vis = includePrivate
        ? ''
        : mine
          ? `AND (visibility='public' OR author_cid = ?)`
          : `AND visibility='public'`
      const visArgs = mine ? [viewerCid] : []

      const total = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM comments WHERE parent_id IS NULL ${vis}`)
          .get(...visArgs) as { n: number }
      ).n
      const totalPages = Math.max(1, Math.ceil(total / size))
      const cur = Math.min(Math.max(1, Math.floor(page)), totalPages)
      const offset = (cur - 1) * size

      const rootIds = (
        db
          .prepare(
            `SELECT id FROM comments WHERE parent_id IS NULL ${vis}
             ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(...visArgs, size, offset) as { id: number }[]
      ).map((r) => r.id)

      if (rootIds.length === 0) {
        return { rows: [], total, page: cur, pageSize: size, totalPages }
      }

      const ph = rootIds.map(() => '?').join(',')
      const rows = db
        .prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT id FROM comments WHERE id IN (${ph})
             UNION ALL
             SELECT c.id FROM comments c JOIN tree t ON c.parent_id = t.id
           )
           SELECT ${COMMENT_COLS} FROM comments
           WHERE id IN (SELECT id FROM tree) ${vis}
           ORDER BY created_at ASC, id ASC`,
        )
        .all(...rootIds, ...visArgs) as CommentRow[]

      return { rows, total, page: cur, pageSize: size, totalPages }
    },

    getComment(id) {
      const r = db.prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(id)
      return (r as CommentRow) ?? null
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

    deleteComment(id) {
      // 递归删除整棵子树(含回复的回复)
      const info = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM comments WHERE id = ?
             UNION ALL
             SELECT c.id FROM comments c JOIN sub s ON c.parent_id = s.id
           )
           DELETE FROM comments WHERE id IN (SELECT id FROM sub)`,
        )
        .run(id)
      return info.changes > 0
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
