// 访客身份的 cookie 命名空间:模拟访客(MOCK)时,身份相关的偏好按身份分键,
// 使每个 mock 身份等价于"一台独立设备"(各自的身份/昵称/主题),互不影响。

import { THEME_STORAGE_KEY } from '../theme.js'

const NS_SEP = '.'

/** 键后缀:无 mock → ''(本人,用原键);有 mock → '.mock-alice' */
export const selSuffix = (mockId?: string | null): string => (mockId ? `${NS_SEP}${mockId}` : '')

/** 昵称 cookie 键(客户端可读) */
export const nickKey = (mockId?: string | null): string => `zx_nick${selSuffix(mockId)}`

/** 主题 localStorage 键(带身份后缀) */
export const themeKey = (mockId?: string | null): string => `${THEME_STORAGE_KEY}${selSuffix(mockId)}`

/** 访客自定义应用栏顺序的 localStorage 键(带身份后缀)
 *  → 每个 mock 身份各自一份顺序,切 A/B/C 时互不影响,便于验证「不同访客独立」 */
export const appsOrderKey = (mockId?: string | null): string => `zx_apps.order${selSuffix(mockId)}`

/** AI 状态灯「念一句」的开关 localStorage 键(带身份后缀)
 *  → 属个人偏好(同昵称/主题规则):切换 mock 身份时各自静音或开启,互不影响 */
export const aiVoiceKey = (mockId?: string | null): string => `zx_ai.voice${selSuffix(mockId)}`
