import type Database from 'better-sqlite3'
import type {
  CommentRow,
  NewEventInput,
  PagedArchived,
  PagedComments,
  StatsResult,
  UsageRow,
  Visibility,
} from '../../schema.js'

/** better-sqlite3 连接实例类型 */
export type SqliteDb = Database.Database

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
  /** 删除留言 = 归档整棵子树(admin/visitor 删除均可查回);byCid 记录删除动作发起者 */
  archiveComment(id: number, by: 'admin' | 'visitor', byCid?: string): boolean
  /** 从归档恢复整棵子树 */
  restoreComment(id: number): boolean
  /** 物理删除整棵子树(归档内彻底删除) */
  purgeComment(id: number): boolean
  /** 归档留言列表(仅站长接口) */
  listArchived(opts?: { page?: number; pageSize?: number }): PagedArchived
  listUsage(days?: number): UsageRow[]
  allUsage(): UsageRow[]
  addUsage(input: NewUsageInput): UsageRow
  /** 记录埋点事件(访问/项目点击/简历下载) */
  addEvent(input: NewEventInput): void
  /** 首页统计聚合(PV/UV/趋势/留言/事件;visitors 仅在 opts.visitors=true 时计算) */
  stats(opts?: { trendDays?: number; onlineMinutes?: number; visitors?: boolean }): StatsResult
  countComments(): number
  clearComments(): number
  getMeta(key: string): string | null
  setMeta(key: string, value: string): void
  delMeta(key: string): void
  close(): void
}

export type CommentStore = Pick<
  Db,
  | 'listPublicComments'
  | 'listAllComments'
  | 'listThreadPage'
  | 'getComment'
  | 'getCommentCid'
  | 'addComment'
  | 'archiveComment'
  | 'restoreComment'
  | 'purgeComment'
  | 'listArchived'
  | 'countComments'
  | 'clearComments'
>

export type UsageStore = Pick<Db, 'listUsage' | 'allUsage' | 'addUsage'>
export type EventStore = Pick<Db, 'addEvent'>
export type StatsStore = Pick<Db, 'stats'>
export type MetaStore = Pick<Db, 'getMeta' | 'setMeta' | 'delMeta'>
