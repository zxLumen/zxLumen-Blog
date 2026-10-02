import type Database from 'better-sqlite3'
import type {
  ChatDayCount,
  ChatLogRow,
  ChatSessionPage,
  ChatSessionRow,
  CommentRow,
  KbChunkRow,
  KbDocRow,
  NewChatLogInput,
  NewEventInput,
  PagedArchived,
  PagedComments,
  StatsResult,
  UsageRow,
  VisitorAlias,
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

export interface NewFeedbackInput {
  cid?: string
  message: string
  contact?: string
  path?: string
  ua?: string
  ip?: string
  status?: 'pending' | 'sent' | 'failed'
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
  /** 入库一条访客反馈,返回新行 id */
  addFeedback(input: NewFeedbackInput): number
  /** 更新反馈的发信状态(pending→sent/failed) */
  setFeedbackStatus(id: number, status: 'pending' | 'sent' | 'failed'): void
  /** 记录埋点事件(访问/项目点击/简历下载) */
  addEvent(input: NewEventInput): void
  /** 同上但按 (cid, day, type, target) 去重(同一人同一天同一目标只记一次),返回是否真的写入 */
  addEventOnce(input: NewEventInput): boolean
  /** 首页统计聚合(PV/UV/趋势/留言/事件;visitors 仅在 opts.visitors=true 时计算) */
  stats(opts?: { trendDays?: number; onlineMinutes?: number; visitors?: boolean }): StatsResult
  /** 站长给某访客的备注(未备注返回 null;仅服务端/站长接口使用) */
  getVisitorAlias(cid: string): VisitorAlias | null
  /** 全部已备注的访客(按更新时间倒序;仅站长接口使用) */
  listVisitorAliases(): VisitorAlias[]
  /** 写入/清除某访客的备注(空字符串 = 清除);返回落库后的行或 null(已清除) */
  setVisitorAlias(cid: string, alias: string): VisitorAlias | null
  countComments(): number
  clearComments(): number
  getMeta(key: string): string | null
  setMeta(key: string, value: string): void
  delMeta(key: string): void
  /** 元键列表(按字面前缀,用于「按前缀找回历史键」,如 opencode 快照) */
  listMetaKeys(prefix: string): string[]

  // 问答机器人
  addChatLog(input: NewChatLogInput): ChatLogRow
  listChatLogs(opts?: { limit?: number; session_id?: string }): ChatLogRow[]
  /** 某 cid 在指定北京日(YYYY-MM-DD)的提问条数(每日上限用) */
  countChatByCidDay(cid: string, day: string): number
  chatDayCounts(days?: number): ChatDayCount[]
  /**
   * 会话列表:按 `session_id` 归并,按最后一条消息时间倒序 + offset 分页。
   * `q` 命中 content(也会匹配 session_id,方便直接粘 id 查),`cid`/`day` 精确匹配。
   * 筛选先圈出命中的 session_id,再对这些会话的**全部**消息做聚合 ——
   * 否则「搜到一个词」会让该会话的轮数/token 只统计到命中的那几条。
   */
  listChatSessions(opts?: {
    limit?: number
    offset?: number
    q?: string
    cid?: string
    day?: string
  }): ChatSessionPage
  /** 批量取这些会话的完整消息(一次查询,避免 N+1);按 id 升序 */
  listChatLogsBySessions(sessionIds: string[]): ChatLogRow[]
  /** 删除一次对话的全部消息;返回删除条数 */
  deleteChatSession(sessionId: string): number
  /** 只保留最近 `keepDays` 个北京日(含今天)的日志;返回删除条数 */
  pruneChatLogs(keepDays: number): number
  deleteAllChatLogs(): number
  countChatLogs(): number

  // 知识库
  upsertKbDoc(input: {
    source: string
    kind: KbDocRow['kind']
    title?: string
    size?: number
    sha?: string
    status?: KbDocRow['status'] | 'ignored'
    error?: string
  }): number
  listKbDocs(): KbDocRow[]
  getKbDoc(source: string): KbDocRow | null
  clearKbChunks(docId: number): void
  /** 删除某篇 doc(连同其 chunks 与 FTS 行);用于 corpus 文件被移除/改名后的对账 */
  deleteKbDoc(id: number): void
  addKbChunk(input: {
    doc_id: number
    idx: number
    content: string
    source: string
    vector?: Uint8Array | null
    token_len?: number
  }): void
  /** 取全部带向量的知识块(供余弦检索;语料量级小,内存计算即可) */
  listKbChunksWithVector(): KbChunkRow[]
  /** FTS5 关键词检索(未配置向量时退化方案) */
  ftsSearch(query: string, limit?: number): Array<{ id: number; content: string; source: string }>
  /** 知识库是否有块(有没有可检索内容) */
  hasKbChunks(): boolean
  countKbChunks(): number
  clearKb(): void

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
export type FeedbackStore = Pick<Db, 'addFeedback' | 'setFeedbackStatus'>
export type EventStore = Pick<Db, 'addEvent' | 'addEventOnce'>
export type StatsStore = Pick<Db, 'stats'>
export type MetaStore = Pick<Db, 'getMeta' | 'setMeta' | 'delMeta' | 'listMetaKeys'>
export type VisitorStore = Pick<Db, 'getVisitorAlias' | 'listVisitorAliases' | 'setVisitorAlias'>
export type ChatStore = Pick<
  Db,
  | 'addChatLog'
  | 'listChatLogs'
  | 'listChatSessions'
  | 'listChatLogsBySessions'
  | 'deleteChatSession'
  | 'pruneChatLogs'
  | 'countChatByCidDay'
  | 'chatDayCounts'
  | 'deleteAllChatLogs'
  | 'countChatLogs'
>
export type KbStore = Pick<
  Db,
  | 'upsertKbDoc'
  | 'listKbDocs'
  | 'getKbDoc'
  | 'clearKbChunks'
  | 'addKbChunk'
  | 'deleteKbDoc'
  | 'listKbChunksWithVector'
  | 'ftsSearch'
  | 'clearKb' | 'hasKbChunks' | 'countKbChunks'>
