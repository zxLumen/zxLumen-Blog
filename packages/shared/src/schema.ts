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
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,            -- UTC 'YYYY-MM-DD HH:MM:SS'
  day      TEXT NOT NULL,            -- 北京时 YYYY-MM-DD
  cid      TEXT DEFAULT '',          -- 访客匿名 ID(UV 依据)
  type     TEXT NOT NULL,            -- 'visit' | 'project_click' | 'resume_download' | 'leave'
  target   TEXT DEFAULT '',          -- 路径 / 项目 id / 文件名
  ua       TEXT DEFAULT '',
  referrer TEXT DEFAULT '',          -- 落地来源(访客 document.referrer,仅 admin 可见)
  dwell    INTEGER DEFAULT 0         -- 前台停留秒数(仅 leave 事件)
);

CREATE INDEX IF NOT EXISTS idx_events_day_type ON events(day, type);
CREATE INDEX IF NOT EXISTS idx_events_cid ON events(cid);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS chat_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT DEFAULT '',                  -- 一次对话(访客侧 UUID)
  cid         TEXT DEFAULT '',                  -- 访客匿名 ID(MOCK 时用 mock 身份)
  day         TEXT DEFAULT '',                  -- 北京时 YYYY-MM-DD(按日统计/限流)
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL,
  provider    TEXT DEFAULT '',                  -- 实际使用的 provider id
  model       TEXT DEFAULT '',
  in_tokens   INTEGER DEFAULT 0,
  out_tokens  INTEGER DEFAULT 0,
  latency_ms  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_ts ON chat_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_session ON chat_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_cid ON chat_logs(cid);

CREATE TABLE IF NOT EXISTS kb_docs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,                    -- 文件路径 / 来源名
  kind        TEXT NOT NULL DEFAULT 'knowledge' CHECK (kind IN ('persona','knowledge')),
  title       TEXT DEFAULT '',
  size        INTEGER DEFAULT 0,
  sha         TEXT DEFAULT '',                  -- 内容哈希(增量蒸馏判定依据)
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | processed | error
  error       TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id      INTEGER NOT NULL,
  idx         INTEGER NOT NULL DEFAULT 0,        -- 块序号
  content     TEXT NOT NULL,
  vector      BLOB,                              -- 稠密向量(float32 LE,可为空=仅关键词)
  source      TEXT DEFAULT '',
  token_len   INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(content, source);
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
  /** OpenCode:service account 名(可当 key 维度筛选) */
  serviceAccount?: string
  requests?: number
  cost?: number
}

export type Visibility = 'public' | 'private'

/** 埋点事件类型(leave = 离开页面;section_view = 区块浏览,均携带 dwell 秒数;contact_click = 联系方式点击) */
export type EventType =
  | 'visit'
  | 'project_click'
  | 'resume_download'
  | 'leave'
  | 'section_view'
  | 'contact_click'

/** 联系方式点击的目标(email | wechat | phone | github | guestbook) */
export type ContactTarget = 'email' | 'wechat' | 'phone' | 'github' | 'guestbook'

export interface NewEventInput {
  type: EventType
  target?: string
  cid?: string
  ua?: string
  /** 落地来源(referrer) */
  referrer?: string
  /** 前台停留秒数(仅 leave 事件) */
  dwell?: number
}

export interface DayPoint {
  day: string
  pv: number
  uv: number
}

/** 单个访客的最近一条操作记录(时间与目标;区块浏览 target 形如 `/#usage`) */
export interface VisitorEvent {
  /** 北京时间 MM-DD HH:mm:ss */
  ts: string
  type: EventType
  target: string
  /** 停留秒数(仅 leave 事件) */
  dwell?: number
}

/** 单个访客的访问详情(仅站长接口/页面使用) */
export interface VisitorDetail {
  cid: string
  /** 曾在留言中留下的昵称(未留过则空) */
  nickname: string
  /** 北京时间 MM-DD HH:mm */
  lastSeen: string
  /** 北京时间 MM-DD HH:mm */
  firstSeen: string
  /** 是否回头客(访问 > 1 次) */
  returning: boolean
  /** 设备描述,如 "Windows · Chrome · 桌面" */
  device: string
  /** 会话数(相邻事件间隔 > 30 分钟切一次) */
  sessions: number
  /** 平均会话时长(秒) */
  avgSessionSec: number
  /** 落地来源(首个非空 referrer,空表示直接打开) */
  referrer: string
  visits: number
  resumeDownloads: number
  commentCount: number
  /** 各项目点击次数(projectId → count) */
  projectClicks: Record<string, number>
  /** 最近若干条操作 */
  recent: VisitorEvent[]
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
    /** 联系方式点击总次数 */
    contactClicks: number
    /** 各联系方式点击次数(email/wechat/phone/github/guestbook → count) */
    contactsByTarget: Record<string, number>
  }
  /** 访客访问详情(按最近活跃,仅站长接口) */
  visitors: VisitorDetail[]
}

/**
 * admin 可增删/排序的项目(整表覆盖模式,存 meta 键 `projects_config`)。
 * 存 DB 时按数组顺序即展示顺序;`deleted=true` 表示已移入垃圾箱(首页不显示)。
 * 含 deleted 字段是为了支持「软删除 + 可恢复/彻底删除」。
 */
/** 一条问答记录(访客问 / 机器人答) */
export interface ChatLogRow {
  id: number
  session_id: string
  cid: string
  role: 'user' | 'assistant'
  content: string
  provider: string
  model: string
  in_tokens: number
  out_tokens: number
  latency_ms: number
  created_at: string
}

export interface NewChatLogInput {
  session_id?: string
  cid?: string
  role: 'user' | 'assistant'
  content: string
  provider?: string
  model?: string
  in_tokens?: number
  out_tokens?: number
  latency_ms?: number
}

export interface ChatDayCount {
  day: string
  count: number
}

/** 知识库文档(一份源文件的元信息 + 分类 + 处理状态) */
export interface KbDocRow {
  id: number
  source: string
  /** 蒸馏自动分类:a=人格素材(personal 口吻),b=事实知识(可检索) */
  kind: 'persona' | 'knowledge'
  title: string
  size: number
  sha: string
  status: 'pending' | 'processed' | 'error'
  error: string
  created_at: string
  updated_at: string
}

/** 知识块(从文档切出的一段文本 + 可选稠密向量) */
export interface KbChunkRow {
  id: number
  doc_id: number
  idx: number
  content: string
  vector: Uint8Array | null
  source: string
  token_len: number
}

export interface StoredProject {
  id: string
  name: string
  desc: string
  tech: string[]
  status: 'online' | 'demo' | 'building' | 'archived'
  /** 分类:personal=个人新项目(含本站),work=历史工作成果 */
  kind?: 'personal' | 'work'
  period?: string
  demoUrl?: string
  repoUrl?: string
  highlights?: { label: string; value: string }[]
  featured?: boolean
  /** true=在垃圾箱(首页不显示);缺省/false=正常 */
  deleted?: boolean
}
