'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { THEMES } from '../theme.js'
import { usePrefs } from './theme-context.js'
import { ThemeGrid } from './PickGrid.js'

interface Pos {
  top: number
  left: number
  width: number
}

export function ThemePicker() {
  const { themeMeta } = usePrefs()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  // 依据按钮位置计算 fixed 坐标:优先右侧/下方,溢出则翻转
  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(560, vw - 32)

    let left = r.right + 10
    let top = r.top
    // 右侧空间不够 → 放到按钮左侧
    if (left + width > vw - 12) {
      left = r.left - 10 - width
    }
    // 左侧也放不下 → 左对齐到按钮下方
    if (left < 12) {
      left = Math.min(Math.max(12, r.left), vw - width - 12)
      top = r.bottom + 8
    }
    // 垂直溢出 → 上移
    const estH = Math.min(520, vh - 24)
    if (top + estH > vh - 12) top = Math.max(12, vh - 12 - estH)

    setPos({ top, left, width })
  }, [])

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

  // 点击外部 / Esc 关闭
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
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, right: 'auto' }}
          >
            <div className="zx-tabs">
              <span className="zx-tab is-active" style={{ cursor: 'default' }}>
                主题 · {THEMES.length}
              </span>
            </div>
            <ThemeGrid />
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
        title="切换主题"
      >
        <span className="dot" />
        {themeMeta.label}
        <span className="caret">▾</span>
      </button>
      {popover}
    </>
  )
}
