// 两份 demo(SQLite)共用 schema

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author      TEXT NOT NULL,
  author_link TEXT DEFAULT '',
  body        TEXT NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  parent_id   INTEGER DEFAULT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  ip          TEXT DEFAULT '',
  author_cid  TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  archived    INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  archived_by TEXT DEFAULT '',
  archived_by_cid TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_comments_visibility ON comments(visibility, created_at);

CREATE TABLE IF NOT EXISTS usage (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
  source          TEXT DEFAULT 'report'
);

CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,            -- UTC 'YYYY-MM-DD HH:MM:SS'
  day    TEXT NOT NULL,            -- 北京时 YYYY-MM-DD
  cid    TEXT DEFAULT '',          -- 访客匿名 ID(UV 依据)
  type   TEXT NOT NULL,            -- 'visit' | 'project_click' | 'resume_download'
  target TEXT DEFAULT '',          -- 路径 / 项目 id / 文件名
  ua     TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_events_day_type ON events(day, type);
CREATE INDEX IF NOT EXISTS idx_events_cid ON events(cid);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
`

export interface CommentRow {
  id: number
  author: string
  author_link?: string
  body: string
  visibility: 'public' | 'private'
  parent_id?: number | null
  is_admin?: number
  ip?: string
  /** 访客匿名 ID:仅站长接口返回(前端其他场景不下发) */
  author_cid?: string
  /** 是否为当前访客本人所发(用于显示"删除"按钮) */
  mine?: boolean
  created_at: string
}

/** 已归档(被删除)的留言:admin 或访客删除后进入归档 */
export interface ArchivedCommentRow {
  id: number
  author: string
  author_link?: string
  body: string
  visibility: 'public' | 'private'
  parent_id?: number | null
  is_admin?: number
  ip?: string
  author_cid?: string
  created_at: string
  /** 归档时间 */
  archived_at: string
  /** 谁删除的:admin(站长)/ visitor(访客) */
  archived_by: 'admin' | 'visitor'
  /** 删除动作发起者的匿名 ID(访客删除时;站长删除留空) */
  archived_by_cid?: string
}

export interface PagedArchived {
  rows: ArchivedCommentRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** 按"顶层留言 + 其整棵回复子树"分页的结果 */
export interface PagedComments {
  /** 当前页的顶层留言及其全部回复 */
  rows: CommentRow[]
  /** 顶层留言总数(用于页码) */
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface UsageRow {
  id?: number
  ts: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheHitTokens: number
  source?: string
  /** 以下为平台聚合数据(真实用量)可选字段 */
  apiKey?: string
  requests?: number
  cost?: number
}

export type Visibility = 'public' | 'private'

/** 埋点事件类型 */
export type EventType = 'visit' | 'project_click' | 'resume_download'

export interface NewEventInput {
  type: EventType
  target?: string
  cid?: string
  ua?: string
}

export interface DayPoint {
  day: string
  pv: number
  uv: number
}

/** 首页统计数据(聚合,不含 cid/ip 等明细) */
export interface StatsResult {
  visits: {
    /** 总访问量 */
    pv: number
    /** 总独立访客(cid 去重) */
    uv: number
    today: { pv: number; uv: number }
    /** 近 N 分钟活跃独立访客(在线估算) */
    online: number
    /** 近 30 天趋势 */
    days: DayPoint[]
  }
  comments: {
    total: number
    today: number
    publicCount: number
    privateCount: number
    authors: number
  }
  events: {
    projectClicks: number
    resumeDownloads: number
    /** 各项目点击次数(projectId → count) */
    clicksByTarget: Record<string, number>
  }
}