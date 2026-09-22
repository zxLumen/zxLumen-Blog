'use client'

import type { Contacts } from '../content.js'
import type { CommentRow, PagedComments, UsageRow } from '../schema.js'
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
  isAdmin?: boolean
  apiBase?: string
  initialAuthor?: string
  contacts?: Contacts
  onSubmitComment?: (input: NewComment) => Promise<CommentRow> | CommentRow
}

/** 首页内容 */
export function HomePage({
  commentsPage,
  usage,
  usageWindow,
  isAdmin,
  apiBase,
  initialAuthor,
  contacts,
  onSubmitComment,
}: HomePageProps) {
  return (
    <>
      <Hero />
      <ProjectsSection />
      <UsageSection rows={usage} window={usageWindow} />
      <AboutSection contacts={contacts} />
      <GuestbookSection
        page={commentsPage}
        submit={onSubmitComment}
        isAdmin={isAdmin}
        apiBase={apiBase}
        initialAuthor={initialAuthor}
      />
    </>
  )
}
