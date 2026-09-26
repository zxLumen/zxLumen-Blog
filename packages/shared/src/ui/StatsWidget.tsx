'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StatsResult } from '../schema.js'
import { fmtCompact } from '../format.js'
import { FLOAT_MARGIN, snapEdge } from './floating.js'
import { useBarTooltip } from './BarTooltip.js'

const POS_KEY = 'zx-stats-pos'
const POP_W = 232
const POP_H = 230

/** 右上角悬浮访客统计:可拖动,点击展开浮层(显示今日数值 + 近 7 天 PV/UV 可切换柱图) */
export function StatsWidget({ stats }: { stats?: StatsResult }) {
  const [open, setOpen] = useState(false)
  const [series, setSeries] = useState<'pv' | 'uv'>('pv')
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
  const barTip = useBarTooltip()

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
          if (!p) return p
          const el = btnRef.current
          const w = el?.offsetWidth ?? 120
          const h = el?.offsetHeight ?? 28
          const snapped = {
            x: snapEdge(p.x, window.innerWidth - w - FLOAT_MARGIN),
            y: snapEdge(p.y, window.innerHeight - h - FLOAT_MARGIN),
          }
          try {
            window.localStorage.setItem(POS_KEY, JSON.stringify(snapped))
          } catch {
            /* ignore */
          }
          return snapped
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

  if (!stats) return null

  const { visits } = stats
  const today = visits.today
  const days = visits.days.slice(-7)
  const val = (d: (typeof days)[number]) => (series === 'pv' ? d.pv : d.uv)
  const maxV = Math.max(1, ...days.map(val))
  const seriesName = series === 'pv' ? '访问量(PV)' : '独立访客(UV)'

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
              <button
                type="button"
                className={`zx-statswidget-cell${series === 'pv' ? ' is-active' : ''}`}
                aria-pressed={series === 'pv'}
                onClick={() => setSeries('pv')}
              >
                <div className="zx-statswidget-val">{fmtCompact(today.pv)}</div>
                <div className="zx-statswidget-lbl">今日访问(PV)</div>
              </button>
              <button
                type="button"
                className={`zx-statswidget-cell${series === 'uv' ? ' is-active' : ''}`}
                aria-pressed={series === 'uv'}
                onClick={() => setSeries('uv')}
              >
                <div className="zx-statswidget-val">{fmtCompact(today.uv)}</div>
                <div className="zx-statswidget-lbl">今日访客(UV)</div>
              </button>
            </div>
            <div
              className="zx-statswidget-trend"
              onMouseMove={barTip.onMouseMove}
              onMouseLeave={barTip.onMouseLeave}
            >
              {days.map((d) => (
                <div
                  key={d.day}
                  className={`zx-bar${val(d) === 0 ? ' is-zero' : ''}`}
                  data-label={`${d.day.slice(5)} · PV ${d.pv} / UV ${d.uv}`}
                  style={{ height: `${Math.max(3, (val(d) / maxV) * 100)}%` }}
                />
              ))}
            </div>
            {barTip.node}
            <div className="zx-statswidget-foot zx-muted zx-mono">近 7 天 · {seriesName}</div>
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
        <span className="zx-mono">今日 {fmtCompact(today.pv)}</span>
        <span className="zx-statswidget-sep">·</span>
        <span className="zx-mono zx-muted">访客 {fmtCompact(today.uv)}</span>
      </button>
      {popover}
    </>
  )
}
