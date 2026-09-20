'use client'

import { useEffect, useRef, useState } from 'react'
import { usePrefs } from './theme-context.js'
import { LayoutGrid, ThemeGrid } from './PickGrid.js'

export function ThemePicker() {
  const { themeMeta, themes, layouts } = usePrefs()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'theme' | 'layout'>('theme')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onClose = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    ref.current?.addEventListener('zx-close', onClose)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div className="zx-picker" ref={ref}>
      <button
        type="button"
        className={`zx-picker-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={layouts.length > 1 ? '切换主题 / 布局' : '切换主题'}
      >
        <span className="dot" />
        {themeMeta.label}
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className="zx-pop">
          <div className="zx-tabs">
            <button
              type="button"
              className={`zx-tab${tab === 'theme' ? ' is-active' : ''}`}
              onClick={() => setTab('theme')}
            >
              主题 · {themes.length}
            </button>
            {layouts.length > 1 && (
              <button
                type="button"
                className={`zx-tab${tab === 'layout' ? ' is-active' : ''}`}
                onClick={() => setTab('layout')}
              >
                布局 · {layouts.length}
              </button>
            )}
          </div>
          {tab === 'theme' || layouts.length <= 1 ? <ThemeGrid /> : <LayoutGrid />}
        </div>
      )}
    </div>
  )
}
