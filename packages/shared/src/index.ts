// 主题 / 布局元数据
export {
  THEMES,
  THEME_IDS,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEME_INIT_SCRIPT,
  isValidTheme,
  getTheme,
  LAYOUTS,
  LAYOUT_IDS,
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  isValidLayout,
} from './theme.js'
export type { Theme, Texture, Mode, Layout, LayoutId } from './theme.js'

// 内容资料
export {
  PROFILE,
  LINKS,
  TECH,
  TIMELINE,
  PROJECTS,
  NAV,
  SITE_META,
} from './content.js'
export type { LinkItem, TechItem, TimelineEntry, Project } from './content.js'

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