'use client'

import type { Contacts, LinkItem, Profile, Project, TechItem, TimelineEntry } from '../content.js'
import type { CommentRow, PagedComments, StatsResult, UsageRow } from '../schema.js'
import type { SourceAvailability, UsageSel } from '../usage-sel.js'
import { Hero } from './Hero.js'
import { ProjectsSection } from './ProjectsSection.js'
import { UsageSection } from './UsageSection.js'
import { StatsWidget } from './StatsWidget.js'
import { StatusWidget } from './StatusWidget.js'
import { TrackBeacon } from './TrackBeacon.js'
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
  availableSources?: SourceAvailability
  isAdmin?: boolean
  apiBase?: string
  initialAuthor?: string
  /** 当前模拟访客身份(昵称/主题按身份分键) */
  viewerMock?: string
  /** 首页统计聚合(SSR 计算) */
  stats?: StatsResult
  contacts?: Contacts
  /** 个人资料 / 站点导航链接 / 技能 / 时间线(服务端注入运行时内容) */
  profile?: Profile
  links?: LinkItem[]
  tech?: TechItem[]
  timeline?: TimelineEntry[]
  /** 项目(已合并 admin 覆盖;缺省用静态 PROJECTS) */
  projects?: Project[]
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
  stats,
  contacts,
  profile,
  links,
  tech,
  timeline,
  projects,
  onSubmitComment,
}: HomePageProps) {
  return (
    <>
      <TrackBeacon path="/" />
      <StatsWidget stats={stats} />
      <StatusWidget />
      <Hero profile={profile} />
      <ProjectsSection projects={projects} clicks={stats?.events.clicksByTarget} pv={stats?.visits.pv} />
      <UsageSection rows={usage} window={usageWindow} initialSel={initialSel} availableSources={availableSources} />
      <AboutSection contacts={contacts} profile={profile} links={links} tech={tech} timeline={timeline} />
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
