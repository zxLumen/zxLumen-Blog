// 主题 / 布局元数据
export {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  themeInitScript,
  isValidTheme,
  getTheme,
  LAYOUTS,
  LAYOUT_IDS,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  isValidLayout,
  LIVE_THEME_IDS,
  LIVE_LAYOUT_IDS,
} from './theme.js'
export type { Theme, Texture, Mode, Layout, LayoutId } from './theme.js'

// 功能特性门控(正式放行集 + 测试全放行)
export { FEATURE_IDS, LIVE_FEATURES, isFeatureAllowed } from './features.js'
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
export type { CommentRow, PagedComments, UsageRow, Visibility } from './schema.js'

// 格式化
export { fmtInt, fmtCompact, fmtCny, fmtDate, fmtDateTime } from './format.js'

// 用量区块筛选存档(客户端/服务端共用)
export { USAGE_SEL_COOKIE, DEFAULT_SEL, defaultRangeSel, parseUsageSel, encodeUsageSel, writeUsageSelCookie } from './usage-sel.js'
export type { UsageSel, RangeSel, Range as UsageRange, DataSource as UsageSource } from './usage-sel.js'

// OpenCode Go 订阅价目(费用折算)
export { GO_MODELS, goPriceOf, estimateGoCost, isGoModelKnown, expiredPromos } from './go-pricing.js'
export type { GoModel, GoPrice } from './go-pricing.js'