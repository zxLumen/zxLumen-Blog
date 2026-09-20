/**
 * 功能特性门控(与 LIVE_THEME_IDS / LIVE_LAYOUT_IDS 同款白名单)。
 *
 * 工作流:新功能默认"只在测试模式生效",在 TEST 模式验证通过后,
 * 再把其 id 加进 LIVE_FEATURES(晋升/同步到正常模式)。
 */

/** 全部功能特性(测试模式放行全部) */
export const FEATURE_IDS = [
  // admin 顶部 Tab 分栏:留言 / 个人信息 / Token 用量
  'admin-tabs',
] as const

export type FeatureId = (typeof FEATURE_IDS)[number]

/** 正式环境放行的集合;晋升新功能 = 把 id 加进这里 */
export const LIVE_FEATURES: FeatureId[] = []

/** 当前模式下某功能是否放行(测试模式恒为 true) */
export function isFeatureAllowed(id: FeatureId, testMode: boolean): boolean {
  return testMode || LIVE_FEATURES.includes(id)
}
