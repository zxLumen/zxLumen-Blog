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
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
  created_at: string
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