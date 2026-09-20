'use client'

import { THEMES } from '../theme.js'
import { usePrefs } from './theme-context.js'

export function ThemeGrid({ onPick }: { onPick?: () => void }) {
  const { theme, setTheme } = usePrefs()
  return (
    <div className="zx-pick-grid">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`zx-pick-card${theme === t.id ? ' is-active' : ''}`}
          onClick={() => {
            setTheme(t.id)
            onPick?.()
          }}
        >
          <span className="zx-pick-swatch">
            <i style={{ background: t.swatch[0] }} />
            <i style={{ background: t.swatch[1] }} />
            <i style={{ background: t.swatch[2] }} />
          </span>
          <span className="zx-pick-name">
            {t.label}
            <span className="k">{t.key}</span>
          </span>
          <span className="zx-pick-tag">{t.tagline}</span>
        </button>
      ))}
    </div>
  )
}
