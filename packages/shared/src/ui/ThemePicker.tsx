'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePrefs } from './theme-context.js'
import { LayoutGrid, ThemeGrid } from './PickGrid.js'

interface Pos {
  top: number
  left: number
  width: number
  maxHeight: number
}

export function ThemePicker() {
  const { themeMeta, themes, layouts } = usePrefs()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'theme' | 'layout'>('theme')
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  // 依据按钮位置计算 fixed 坐标:优先右侧(侧栏场景),否则向下(顶部场景)
  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(600, vw - 32)

    let left = r.right + 10
    let top = r.top

    if (left + width > vw - 12) {
      // 右侧放不下 → 放到按钮下方,右对齐
      left = Math.min(Math.max(12, r.right - width), vw - width - 12)
      top = r.bottom + 8
    }
    if (left < 12) left = 12

    const maxHeight = Math.max(200, vh - top - 12)
    setPos({ top, left, width, maxHeight })
  }, [])

  // 打开时定位;滚动/缩放时跟随
  useLayoutEffect(() => {
    if (!open) return
    place()
    const onScrollResize = () => place()
    window.addEventListener('resize', onScrollResize)
    window.addEventListener('scroll', onScrollResize, true)
    return () => {
      window.removeEventListener('resize', onScrollResize)
      window.removeEventListener('scroll', onScrollResize, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const popover =
    open && mounted && pos
      ? createPortal(
          <div
            ref={popRef}
            className="zx-pop zx-pop-fixed"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              right: 'auto',
              width: pos.width,
              maxHeight: pos.maxHeight,
              overflow: 'auto',
            }}
          >
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
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`zx-picker-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={layouts.length > 1 ? '切换主题 / 布局' : '切换主题'}
      >
        <span className="dot" />
        {themeMeta.label}
        <span className="caret">▾</span>
      </button>
      {popover}
    </>
  )
}
