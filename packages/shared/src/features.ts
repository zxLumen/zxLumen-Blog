/**
 * 功能特性 id 枚举(单一环境,全部放行)。
 *
 * 保留此清单仅作为功能标识/文档用途,不再有 TEST/LIVE 白名单门控。
 */

export const FEATURE_IDS = [
  // admin 顶部 Tab 分栏:留言 / 个人信息 / Token用量
  'admin-tabs',
  // 访客删除自己发过的留言(按匿名 ID 校验)
  'self-delete',
  // Token用量 OpenCode 数据源(读官方 Console,含 hourly 分时)
  'usage-opencode',
  // Token用量智谱数据源(读 monitor API:按模型 token 总量 + 配额)
  'usage-zhipu',
  // 首页统计区块(访客 PV/UV/趋势、留言、项目点击/简历下载)
  'visitor-stats',
] as const

export type FeatureId = (typeof FEATURE_IDS)[number]
