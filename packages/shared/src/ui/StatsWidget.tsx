'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StatsResult } from '../schema.js'
import { fmtCompact } from '../format.js'
import { useFeature } from './theme-context.js'

const POS_KEY = 'zx-stats-pos'
const POP_W = 260
const POP_H = 220

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="zx-statswidget-cell">
      <div className="zx-statswidget-val">{value}</div>
      <div className="zx-statswidget-lbl">{label}</div>
    </div>
  )
}

/** 右上角悬浮访客统计:可拖动,点击展开浮层(仅访客维度) */
export function StatsWidget({ stats }: { stats?: StatsResult }) {
  const on = useFeature('visitor-stats')
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 200)
  }, [])

  useEffect(() => setMounted(true), [])

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  // 恢复上次拖动位置(限定在视口内)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(POS_KEY)
      if (!raw) return
      const p = JSON.parse(raw) as { x: number; y: number }
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) setPos({ x: p.x, y: p.y })
    } catch {
      /* ignore */
    }
  }, [])

  // 拖动
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      d.moved = true
      const el = btnRef.current
      const w = el?.offsetWidth ?? 120
      const h = el?.offsetHeight ?? 28
      const x = Math.min(Math.max(4, e.clientX - d.dx), window.innerWidth - w - 4)
      const y = Math.min(Math.max(4, e.clientY - d.dy), window.innerHeight - h - 4)
      setPos({ x, y })
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      if (d?.moved) {
        setPos((p) => {
          if (p) {
            try {
              window.localStorage.setItem(POS_KEY, JSON.stringify(p))
            } catch {
              /* ignore */
            }
          }
          return p
        })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  // 浮层跟随按钮定位(右下展开,越界则上翻/左对齐)
  const placePop = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(POP_W, window.innerWidth - 24)
    let left = r.right - width
    if (left < 12) left = 12
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12
    let top = r.bottom + 8
    if (top + POP_H > window.innerHeight - 12) top = Math.max(12, r.top - POP_H - 8)
    setPopPos({ left, top })
  }, [])

  useEffect(() => {
    if (!open) return
    placePop()
    window.addEventListener('resize', placePop)
    window.addEventListener('scroll', placePop, true)
    return () => {
      window.removeEventListener('resize', placePop)
      window.removeEventListener('scroll', placePop, true)
    }
  }, [open, pos, placePop])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!on || !stats) return null

  const { visits } = stats
  const days = visits.days.slice(-7)
  const maxPv = Math.max(1, ...days.map((d) => d.pv))

  const btnStyle = pos ? { left: pos.x, top: pos.y, right: 'auto' } : undefined

  const popover =
    open && mounted && popPos
      ? createPortal(
          <div
            ref={popRef}
            className="zx-statswidget-pop"
            style={{ left: popPos.left, top: popPos.top }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className="zx-statswidget-head">
              <span className="zx-mono zx-muted">{'// VISITOR STATS'}</span>
              <button type="button" className="zx-statswidget-close" onClick={() => setOpen(false)} aria-label="关闭">
                ✕
              </button>
            </div>
            <div className="zx-statswidget-grid">
              <Cell label="访问量(PV)" value={fmtCompact(visits.pv)} />
              <Cell label="访客(UV)" value={fmtCompact(visits.uv)} />
            </div>
            <div className="zx-statswidget-trend">
              {days.map((d) => (
                <div
                  key={d.day}
                  className={`zx-bar${d.pv === 0 ? ' is-zero' : ''}`}
                  data-label={`${d.day.slice(5)} · PV ${d.pv} / UV ${d.uv}`}
                  style={{ height: `${Math.max(3, (d.pv / maxPv) * 100)}%` }}
                />
              ))}
            </div>
            <div className="zx-statswidget-foot zx-muted zx-mono">近 7 天 · 访问量(PV)</div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`zx-statswidget-btn${open ? ' is-open' : ''}`}
        style={btnStyle}
        onPointerDown={(e) => {
          const el = btnRef.current
          if (!el) return
          const r = el.getBoundingClientRect()
          dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }
        }}
        onMouseEnter={() => {
          cancelClose()
          setOpen(true)
        }}
        onMouseLeave={scheduleClose}
        title="访客统计(可拖动)"
      >
        <span className="zx-envdot" />
        <span className="zx-mono">访问 {fmtCompact(visits.pv)}</span>
        <span className="zx-statswidget-sep">·</span>
        <span className="zx-mono zx-muted">访客 {fmtCompact(visits.uv)}</span>
      </button>
      {popover}
    </>
  )
}
