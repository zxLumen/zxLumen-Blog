import type { ArchivedCommentRow, CommentRow, PagedComments, Visibility } from '../../schema.js'
import { nowIso } from '../../time.js'
import type { CommentStore, NewCommentInput, SqliteDb } from './types.js'

const COMMENT_COLS = `id, author, author_link, body, visibility, parent_id, is_admin, created_at`
const COMMENT_COLS_CID = `id, author, author_link, body, visibility, parent_id, is_admin, author_cid, created_at`

export function commentStore(db: SqliteDb): CommentStore {
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

    addComment(input: NewCommentInput) {
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

    archiveComment(id, by, byCid = '') {
      // 递归归档整棵子树(删除 = 移入归档,可查回/恢复)
      const info = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM comments WHERE id = @id
             UNION ALL
             SELECT c.id FROM comments c JOIN sub s ON c.parent_id = s.id
           )
           UPDATE comments
           SET archived = 1, archived_at = @at, archived_by = @by, archived_by_cid = @byCid
           WHERE id IN (SELECT id FROM sub)`,
        )
        .run({ id, at: nowIso(), by, byCid })
      return info.changes > 0
    },

    restoreComment(id) {
      // 从归档恢复整棵子树(archived_at/by/by_cid 还原为空)
      const info = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM comments WHERE id = @id
             UNION ALL
             SELECT c.id FROM comments c JOIN sub s ON c.parent_id = s.id
           )
           UPDATE comments
           SET archived = 0, archived_at = NULL, archived_by = '', archived_by_cid = ''
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
      // 与留言板一致:按「归档根留言」分页,子回复随根一起返回(前端按 parent_id 重建嵌套)
      const total = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM comments WHERE archived=1 AND parent_id IS NULL`)
          .get() as { n: number }
      ).n
      const totalPages = Math.max(1, Math.ceil(total / size))
      const cur = Math.min(Math.max(1, Math.floor(page)), totalPages)
      const offset = (cur - 1) * size

      // 根留言:最近删除(archived_at)最靠前;同刻按 id 倒序
      const rootIds = (
        db
          .prepare(
            `SELECT id FROM comments WHERE archived=1 AND parent_id IS NULL
             ORDER BY archived_at DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(size, offset) as { id: number }[]
      ).map((r) => r.id)

      if (rootIds.length === 0) {
        return { rows: [], total, page: cur, pageSize: size, totalPages }
      }

      // root_id:每行所属的归档根,用于按"根的删除顺序"整体排序
      const ph = rootIds.map(() => '?').join(',')
      const rows = db
        .prepare(
          `WITH RECURSIVE tree(id, root_id) AS (
             SELECT id, id FROM comments WHERE id IN (${ph})
             UNION ALL
             SELECT c.id, t.root_id FROM comments c JOIN tree t ON c.parent_id = t.id
           )
           SELECT c.id, c.author, c.author_link, c.body, c.visibility, c.parent_id, c.is_admin, c.ip, c.author_cid, c.created_at, c.archived_at, c.archived_by, c.archived_by_cid,
                  CASE t.root_id ${rootIds.map((_, i) => `WHEN ? THEN ${i}`).join(' ')} END AS root_ord
           FROM comments c
           JOIN tree t ON t.id = c.id
           WHERE c.archived=1
           ORDER BY root_ord ASC, c.parent_id IS NULL DESC, c.created_at ASC, c.id ASC`,
        )
        .all(...rootIds, ...rootIds) as ArchivedCommentRow[]
      return { rows, total, page: cur, pageSize: size, totalPages }
    },

    countComments() {
      return (db.prepare(`SELECT COUNT(*) AS n FROM comments`).get() as { n: number }).n
    },

    clearComments() {
      return db.prepare(`DELETE FROM comments`).run().changes
    },
  }
}
