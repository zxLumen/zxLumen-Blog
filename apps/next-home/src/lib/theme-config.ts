import {
  DEFAULT_APPEARANCE,
  LAYOUT_IDS,
  THEME_IDS,
  isValidLayout,
  isValidTheme,
  type AppearanceConfig,
  type LayoutId,
} from '@zx/shared'
import { getDb } from './db'

const META_KEY = 'appearance_config'

/** 规范化:过滤非法 id、去重、补默认项(默认项必须包含在放行集内) */
export function normalizeAppearance(raw: unknown): AppearanceConfig {
  const safe = (raw ?? {}) as Partial<AppearanceConfig>

  const themes = Array.isArray(safe.themes)
    ? [...new Set(safe.themes.filter((t): t is string => isValidTheme(t)))]
    : []
  const layouts = Array.isArray(safe.layouts)
    ? [...new Set(safe.layouts.filter((l): l is LayoutId => isValidLayout(l)))]
    : []

  // 至少保留一个;空集合回退全量
  const finalThemes = themes.length > 0 ? themes : [...THEME_IDS]
  const finalLayouts = layouts.length > 0 ? layouts : [...LAYOUT_IDS]

  // 默认项必须在放行集内,否则回退放行集首项
  const defaultTheme =
    safe.defaultTheme && finalThemes.includes(safe.defaultTheme) ? safe.defaultTheme : finalThemes[0]
  const defaultLayout =
    safe.defaultLayout && finalLayouts.includes(safe.defaultLayout) ? safe.defaultLayout : finalLayouts[0]

  return { themes: finalThemes, layouts: finalLayouts, defaultTheme, defaultLayout }
}

/** 读取外观配置(admin 可配;缺省为全量放行) */
export function getAppearance(): AppearanceConfig {
  try {
    const raw = getDb().getMeta(META_KEY)
    if (!raw) return DEFAULT_APPEARANCE
    return normalizeAppearance(JSON.parse(raw))
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** 保存外观配置(写入前规范化) */
export function setAppearance(input: unknown): AppearanceConfig {
  const config = normalizeAppearance(input)
  getDb().setMeta(META_KEY, JSON.stringify(config))
  return config
}
