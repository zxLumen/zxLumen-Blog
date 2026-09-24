import type { CommentRow, PagedComments } from '../../schema.js'

export interface NewComment {
  author: string
  author_link: string
  body: string
  visibility: 'public' | 'private'
  parent_id?: number | null
}

export interface GuestbookProps {
  /** 初始分页数据(服务端渲染第 1 页) */
  page?: PagedComments
  /** 自定义提交(默认 POST /api/comments) */
  submit?: (input: NewComment) => Promise<CommentRow> | CommentRow
  /** 已登录 admin:可看私密、可删除、回复为站长 */
  isAdmin?: boolean
  /** API 前缀 */
  apiBase?: string
  /** 服务端预填昵称(cookie 或站长昵称) */
  initialAuthor?: string
  /** 当前模拟访客身份:昵称按身份分键(等价于一台独立设备) */
  viewerMock?: string
}
