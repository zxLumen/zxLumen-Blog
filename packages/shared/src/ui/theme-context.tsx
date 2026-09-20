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
  THEMES,
  THEME_IDS,
  THEME_STORAGE_KEY,
  getTheme,
  isValidTheme,
  type Theme,
} from '../theme.js'

interface PrefsValue {
  theme: string
  themeMeta: Theme
  setTheme: (id: string) => void
  cycleTheme: (dir: 1 | -1) => void
}

const PrefsContext = createContext<PrefsValue | null>(null)
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

function applyTheme(id: string) {
  const t = getTheme(id)
  const d = document.documentElement
  d.dataset.theme = t.id
  d.dataset.texture = t.texture
  d.dataset.mode = t.mode
  // 布局固定为 SIDEBAR
  d.dataset.layout = DEFAULT_LAYOUT
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME)

  // 首帧前恢复偏好(避免闪烁;同时在 Next dev StrictMode 重挂载后重设)
  useIsoLayoutEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    const next = isValidTheme(saved) ? (saved as string) : DEFAULT_THEME
    setThemeState(next)
    applyTheme(next)
  }, [])

  const setTheme = useCallback((id: string) => {
    const next = isValidTheme(id) ? id : DEFAULT_THEME
    setThemeState(next)
    applyTheme(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const cycleTheme = useCallback(
    (dir: 1 | -1) => {
      const i = THEME_IDS.indexOf(theme)
      const next = THEME_IDS[(i + dir + THEME_IDS.length) % THEME_IDS.length]
      setTheme(next)
    },
    [theme, setTheme],
  )

  // 快捷键:数字/字母 → 主题;[ ] 循环;Esc 关闭弹层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return

      if (e.key === '[') return cycleTheme(-1)
      if (e.key === ']') return cycleTheme(1)
      if (e.key === 'Escape') {
        document.querySelectorAll('.zx-pop').forEach((n) => n.dispatchEvent(new Event('zx-close')))
        return
      }

      const k = e.key.toLowerCase()
      const t = THEMES.find((x) => x.key === k)
      if (t) setTheme(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cycleTheme, setTheme])

  const value = useMemo<PrefsValue>(
    () => ({
      theme,
      themeMeta: getTheme(theme),
      setTheme,
      cycleTheme,
    }),
    [theme, setTheme, cycleTheme],
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
