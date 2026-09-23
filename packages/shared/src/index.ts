// 主题 / 布局元数据
export {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME,
  DEFAULT_APPEARANCE,
  APPEARANCE_META_KEY,
  THEME_STORAGE_KEY,
  themeInitScript,
  isValidTheme,
  getTheme,
  LAYOUTS,
  LAYOUT_IDS,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  isValidLayout,
} from './theme.js'
export type { Theme, Texture, Mode, Layout, LayoutId, AppearanceConfig } from './theme.js'

// 功能特性 id(单环境,全部放行)
export { FEATURE_IDS } from './features.js'
export type { FeatureId } from './features.js'

// 内容资料
export {
  PROFILE,
  LINKS,
  TECH,
  TIMELINE,
  PROJECTS,
  NAV,
  NAV_INIT_SCRIPT,
  SITE_META,
  CONTACTS,
  applyProjectOverrides,
} from './content.js'
export type {
  LinkItem,
  TechItem,
  TimelineEntry,
  Project,
  Profile,
  SiteMeta,
  Contacts,
} from './content.js'

// 项目覆盖配置(admin 后台编辑)
export type { ProjectOverrideRecord, ProjectOverrideInput } from './schema.js'

// 计价与统计
export {
  PRICING,
  estimateCost,
  costOfRows,
  tokensOf,
  roundCny,
} from './pricing.js'
export type { ModelPrice, UsageRow as PricingUsageRow, CostParts } from './pricing.js'

// mock 数据(仅供 demo)
export { genMockUsage, dailyAggregate, modelAggregate } from './mock.js'

// 数据库 schema
export { SCHEMA_SQL } from './schema.js'
export type { CommentRow, PagedComments, UsageRow, Visibility, EventType, NewEventInput, DayPoint, StatsResult, VisitorDetail, VisitorEvent } from './schema.js'

// 格式化
export { fmtInt, fmtCompact, fmtCny, fmtDate, fmtDateTime } from './format.js'

// 用量区块筛选存档(客户端/服务端共用)
export { USAGE_SEL_COOKIE, DEFAULT_SEL, defaultRangeSel, parseUsageSel, encodeUsageSel, writeUsageSelCookie, DATA_SOURCES } from './usage-sel.js'
export type { UsageSel, RangeSel, Range as UsageRange, DataSource as UsageSource } from './usage-sel.js'

// OpenCode Go 订阅价目(费用折算)
export { GO_MODELS, goPriceOf, estimateGoCost, isGoModelKnown, expiredPromos } from './go-pricing.js'
export type { GoModel, GoPrice } from './go-pricing.js'