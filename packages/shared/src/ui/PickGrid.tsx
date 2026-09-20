'use client'

import { type LayoutId } from '../theme.js'
import { usePrefs } from './theme-context.js'

/** 布局示意:用不等宽色块暗示版式 */
const SCHEMA: Record<LayoutId, number[]> = {
  classic: [3, 2, 3],
  centered: [1, 3, 1],
  sidebar: [1, 3, 3],
  window: [4, 4, 4],
  hud: [2, 1, 2],
  magazine: [4, 1, 4],
  fullbleed: [8, 8, 8],
  bento: [3, 2, 2],
  compact: [1, 1, 1],
  showcase: [5, 2, 5],
}

export function ThemeGrid({ onPick }: { onPick?: () => void }) {
  const { theme, themes, setTheme } = usePrefs()
  return (
    <div className="zx-pick-grid">
      {themes.map((t) => (
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

export function LayoutGrid({ onPick }: { onPick?: () => void }) {
  const { layout, layouts, setLayout } = usePrefs()
  return (
    <div className="zx-pick-grid">
      {layouts.map((l) => (
        <button
          key={l.id}
          type="button"
          className={`zx-pick-card${layout === l.id ? ' is-active' : ''}`}
          onClick={() => {
            setLayout(l.id)
            onPick?.()
          }}
        >
          <span className="zx-pick-swatch">
            {SCHEMA[l.id].map((n, i) => (
              <i
                key={i}
                style={{
                  flex: n,
                  background:
                    i === 0
                      ? 'var(--accent)'
                      : i === 1
                        ? 'var(--line-strong)'
                        : 'var(--accent-2)',
                }}
              />
            ))}
          </span>
          <span className="zx-pick-name">
            {l.label}
            <span className="k">⇧{l.key}</span>
          </span>
          <span className="zx-pick-tag">{l.tagline}</span>
        </button>
      ))}
    </div>
  )
}
