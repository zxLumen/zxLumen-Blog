'use client'

import type { CommentRow, UsageRow } from '../schema.js'
import { Hero } from './Hero.js'
import { ProjectsSection } from './ProjectsSection.js'
import { UsageSection } from './UsageSection.js'
import { AboutSection } from './AboutSection.js'
import { GuestbookSection, type NewComment } from './GuestbookSection.js'

interface HomePageProps {
  comments?: CommentRow[]
  usage?: UsageRow[]
  isAdmin?: boolean
  apiBase?: string
  initialAuthor?: string
  onSubmitComment?: (input: NewComment) => Promise<CommentRow> | CommentRow
}

/** 首页内容 */
export function HomePage({
  comments,
  usage,
  isAdmin,
  apiBase,
  initialAuthor,
  onSubmitComment,
}: HomePageProps) {
  return (
    <>
      <Hero />
      <ProjectsSection />
      <UsageSection rows={usage} />
      <AboutSection />
      <GuestbookSection
        initial={comments}
        submit={onSubmitComment}
        isAdmin={isAdmin}
        apiBase={apiBase}
        initialAuthor={initialAuthor}
      />
    </>
  )
}
