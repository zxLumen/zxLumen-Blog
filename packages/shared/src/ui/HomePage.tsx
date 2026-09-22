'use client'

import type { Contacts } from '../content.js'
import type { CommentRow, PagedComments, UsageRow } from '../schema.js'
import type { DataSource, UsageSel } from '../usage-sel.js'
import { Hero } from './Hero.js'
import { ProjectsSection } from './ProjectsSection.js'
import { UsageSection } from './UsageSection.js'
import { AboutSection } from './AboutSection.js'
import { GuestbookSection, type NewComment } from './GuestbookSection.js'

interface HomePageProps {
  /** 留言分页数据(第 1 页) */
  commentsPage?: PagedComments
  usage?: UsageRow[]
  /** SSR 阶段 usage 对应的日期窗口(用于柱状图补齐 0 值天) */
  usageWindow?: { start?: string; end?: string }
  /** 用量区块存档(cookie 下发,用于 SSR 首帧渲染正确筛选) */
  initialSel?: UsageSel
  /** 各数据源可用性(SSR 计算;隐藏未配置/无数据的源) */
  availableSources?: Partial<Record<DataSource, boolean>>
  isAdmin?: boolean
  apiBase?: string
  initialAuthor?: string
  /** 当前模拟访客身份(昵称/主题按身份分键) */
  viewerMock?: string
  contacts?: Contacts
  onSubmitComment?: (input: NewComment) => Promise<CommentRow> | CommentRow
}

/** 首页内容 */
export function HomePage({
  commentsPage,
  usage,
  usageWindow,
  initialSel,
  availableSources,
  isAdmin,
  apiBase,
  initialAuthor,
  viewerMock,
  contacts,
  onSubmitComment,
}: HomePageProps) {
  return (
    <>
      <Hero />
      <ProjectsSection />
      <UsageSection rows={usage} window={usageWindow} initialSel={initialSel} availableSources={availableSources} />
      <AboutSection contacts={contacts} />
      <GuestbookSection
        page={commentsPage}
        submit={onSubmitComment}
        isAdmin={isAdmin}
        apiBase={apiBase}
        initialAuthor={initialAuthor}
        viewerMock={viewerMock}
      />
    </>
  )
}
