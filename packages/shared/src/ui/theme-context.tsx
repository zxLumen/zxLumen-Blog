'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import {
  DEFAULT_LAYOUT,
  DEFAULT_THEME,
  LAYOUTS,
  THEMES,
  THEME_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  getTheme,
  type Layout,
  type LayoutId,
  type Theme,
} from '../theme.js'
import type { FeatureId } from '../features.js'

interface PrefsValue {
  theme: string
  layout: LayoutId
  themeMeta: Theme
  layoutMeta: Layout
  themes: Theme[]
  layouts: Layout[]
  /** 当前模式下放行的功能(正式为白名单,测试为全集) */
  features: FeatureId[]
  setTheme: (id: string) => void
  setLayout: (id: LayoutId) => void
  cycleTheme: (dir: 1 | -1) => void
}

const PrefsContext = createContext<PrefsValue | null>(null)
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function PreferencesProvider({
  allowedThemeIds,
  allowedLayoutIds,
  allowedFeatures = [],
  children,
}: {
  allowedThemeIds: string[]
  allowedLayoutIds: LayoutId[]
  allowedFeatures?: FeatureId[]
  children: React.ReactNode
}) {
  const themes = useMemo(
    () => THEMES.filter((t) => allowedThemeIds.includes(t.id)),
    [allowedThemeIds],
  )
  const layouts = useMemo(
    () => LAYOUTS.filter((l) => allowedLayoutIds.includes(l.id)),
    [allowedLayoutIds],
  )

  const [theme, setThemeState] = useState(
    themes.some((t) => t.id === DEFAULT_THEME) ? DEFAULT_THEME : (themes[0]?.id ?? DEFAULT_THEME),
  )
  const [layout, setLayoutState] = useState<LayoutId>(
    layouts.some((l) => l.id === DEFAULT_LAYOUT) ? DEFAULT_LAYOUT : (layouts[0]?.id ?? DEFAULT_LAYOUT),
  )

  const applyTheme = useCallback((id: string) => {
    const t = getTheme(id)
    const d = document.documentElement
    d.dataset.theme = t.id
    d.dataset.texture = t.texture
    d.dataset.mode = t.mode
  }, [])

  const applyLayout = useCallback((id: LayoutId) => {
    document.documentElement.dataset.layout = id
  }, [])

  // 首帧恢复(受 allowed 限制)
  useIsoLayoutEffect(() => {
    const read = (k: string) => {
      try {
        return localStorage.getItem(k)
      } catch {
        return null
      }
    }
    const savedTheme = read(THEME_STORAGE_KEY)
    const nextTheme = savedTheme && themes.some((t) => t.id === savedTheme) ? savedTheme : themes[0].id
    const savedLayout = read(LAYOUT_STORAGE_KEY)
    const nextLayout =
      savedLayout && layouts.some((l) => l.id === savedLayout)
        ? (savedLayout as LayoutId)
        : (layouts[0]?.id ?? DEFAULT_LAYOUT)

    setThemeState(nextTheme)
    setLayoutState(nextLayout)
    applyTheme(nextTheme)
    applyLayout(nextLayout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes, layouts])

  const setTheme = useCallback(
    (id: string) => {
      if (!themes.some((t) => t.id === id)) return
      setThemeState(id)
      applyTheme(id)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, id)
      } catch {
        /* ignore */
      }
    },
    [themes, applyTheme],
  )

  const setLayout = useCallback(
    (id: LayoutId) => {
      if (!layouts.some((l) => l.id === id)) return
      setLayoutState(id)
      applyLayout(id)
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, id)
      } catch {
        /* ignore */
      }
    },
    [layouts, applyLayout],
  )

  const cycleTheme = useCallback(
    (dir: 1 | -1) => {
      const i = themes.findIndex((t) => t.id === theme)
      const next = themes[(i + dir + themes.length) % themes.length]
      setTheme(next.id)
    },
    [themes, theme, setTheme],
  )

  // 快捷键:数字/字母 → 主题;Shift+数字 → 布局(仅当有多个布局);[ ] 循环;Esc 关弹层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const digit = e.code?.startsWith('Digit') ? e.code.slice(5) : null
      if (e.shiftKey) {
        if (digit && layouts.length > 1) {
          const l = layouts.find((x) => x.key === digit)
          if (l) setLayout(l.id)
        }
        return
      }

      if (e.key === '[') return cycleTheme(-1)
      if (e.key === ']') return cycleTheme(1)
      if (e.key === 'Escape') {
        document.querySelectorAll('.zx-pop').forEach((n) => n.dispatchEvent(new Event('zx-close')))
        return
      }
      const k = e.key.toLowerCase()
      const t = themes.find((x) => x.key === k)
      if (t) setTheme(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [themes, layouts, theme, setTheme, setLayout, cycleTheme])

  const value = useMemo<PrefsValue>(
    () => ({
      theme,
      layout,
      themeMeta: getTheme(theme),
      layoutMeta: LAYOUTS.find((l) => l.id === layout) ?? LAYOUTS[0],
      themes,
      layouts,
      features: allowedFeatures,
      setTheme,
      setLayout,
      cycleTheme,
    }),
    [theme, layout, themes, layouts, allowedFeatures, setTheme, setLayout, cycleTheme],
  )

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): PrefsValue {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used within <PreferencesProvider>')
  return ctx
}

/** 兼容旧命名 */
export const useTheme = usePrefs

/** 当前模式下某功能是否放行(如 'admin-tabs');无 Provider 时视为关闭 */
export function useFeature(id: FeatureId): boolean {
  const ctx = useContext(PrefsContext)
  return ctx ? ctx.features.includes(id) : false
}
