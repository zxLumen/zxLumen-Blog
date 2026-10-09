'use client'

import type { Contacts, LinkItem, Profile, Project, TechItem, TimelineEntry } from '../content.js'
import type { CommentRow, PagedComments, StatsResult, StoredProject, UsageRow } from '../schema.js'
import type { VlogSeries, VlogStart } from '../schema.js'
import type { SourceAvailability, UsageSel, DataSource } from '../usage-sel.js'
import type { SiteSections } from './site-edit-types.js'
import { Hero } from './Hero.js'
import { ProjectsSection } from './ProjectsSection.js'
import { UsageSection } from './UsageSection.js'
import { StatsWidget } from './StatsWidget.js'
import { StatusWidget } from './StatusWidget.js'
import { TrackBeacon } from './TrackBeacon.js'
import { AboutSection } from './AboutSection.js'
import { GuestbookSection, type NewComment } from './GuestbookSection.js'
import { SiteContentSaverProvider } from './SiteContentSaver.js'

interface HomePageProps {
  /** 留言分页数据(第 1 页) */
  commentsPage?: PagedComments
  usage?: UsageRow[]
  /** SSR 阶段 usage 对应的日期窗口(用于柱状图补齐 0 值天) */
  usageWindow?: { start?: string; end?: string }
  /** SSR 阶段 usage 所属数据源(缺省 deepseek) */
  usageSource?: DataSource
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
  /** 站长:明文联系方式(含电话),供首页就地编辑;访客不下发 */
  adminContacts?: { email?: string; wechat?: string; phone?: string }
  /** 个人资料 / 站点导航链接 / 技能 / 时间线(服务端注入运行时内容) */
  profile?: Profile
  links?: LinkItem[]
  tech?: TechItem[]
  timeline?: TimelineEntry[]
  sections?: SiteSections
  /** 站点的 SEO meta(title/description/keywords) */
  siteMeta?: { title?: string; description?: string; keywords?: string[] }
  /** 站点内容的乐观锁版本戳(仅站长) */
  siteContentRev?: string
  /** 项目(已合并 admin 覆盖;缺省用静态 PROJECTS) */
  projects?: Project[]
  /** 站长:含垃圾箱的全量项目(供首页直接拖拽排序后整表存回) */
  adminStoredProjects?: StoredProject[]
  /** 站长:项目表乐观锁版本戳(GET 时的指纹) */
  projectsRev?: string
  /** 抖音旅行短视频系列(admin 配置) */
  vlogSeries?: VlogSeries[]
  /** 首页随机起播点(服务端随机;缺省从第一个开始) */
  vlogStart?: VlogStart | null
  onSubmitComment?: (input: NewComment) => Promise<CommentRow> | CommentRow
}

/** 首页内容 */
export function HomePage({
  commentsPage,
  usage,
  usageWindow,
  usageSource,
  initialSel,
  availableSources,
  isAdmin,
  apiBase,
  initialAuthor,
  viewerMock,
  stats,
  contacts,
  adminContacts,
  profile,
  links,
  tech,
  timeline,
  sections,
  siteMeta,
  siteContentRev,
  projects,
  adminStoredProjects,
  projectsRev,
  vlogSeries,
  vlogStart,
  onSubmitComment,
}: HomePageProps) {
  return (
    <SiteContentSaverProvider initialRev={siteContentRev} apiBase={apiBase ?? '/api'}>
      <TrackBeacon path="/" />
      <StatsWidget stats={stats} />
      <StatusWidget />
      <Hero
        profile={profile}
        siteMeta={siteMeta}
        isAdmin={isAdmin}
        vlogSeries={vlogSeries}
        vlogStart={vlogStart}
      />
      <ProjectsSection
        projects={projects}
        isAdmin={isAdmin}
        adminStoredProjects={adminStoredProjects}
        projectsRev={projectsRev}
        clicks={stats?.events.clicksByTarget}
        pv={stats?.visits.pv}
        sectionHeader={sections?.projects}
      />
      <UsageSection
        rows={usage}
        window={usageWindow}
        usageSource={usageSource}
        initialSel={initialSel}
        availableSources={availableSources}
        sectionHeader={sections?.usage}
        isAdmin={isAdmin}
      />
      <AboutSection
        contacts={contacts}
        adminContacts={adminContacts}
        profile={profile}
        links={links}
        tech={tech}
        timeline={timeline}
        sectionHeader={sections?.about}
        isAdmin={isAdmin}
      />
      <GuestbookSection
        page={commentsPage}
        submit={onSubmitComment}
        isAdmin={isAdmin}
        apiBase={apiBase}
        initialAuthor={initialAuthor}
        viewerMock={viewerMock}
        sectionHeader={sections?.guestbook}
      />
    </SiteContentSaverProvider>
  )
}
