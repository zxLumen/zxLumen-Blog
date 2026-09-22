'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StatsResult } from '../schema.js'
import { fmtCompact, fmtInt } from '../format.js'
import { useFeature } from './theme-context.js'

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="zx-statswidget-cell">
      <div className="zx-statswidget-val">{value}</div>
      <div className="zx-statswidget-lbl">{label}</div>
    </div>
  )
}

/** 右上角悬浮访客统计:按钮常驻,点击展开浮层(仅访客维度) */
export function StatsWidget({ stats }: { stats?: StatsResult }) {
  const on = useFeature('visitor-stats')
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

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

  if (!on || !stats) return null

  const { visits } = stats
  const maxPv = Math.max(1, ...visits.days.map((d) => d.pv))

  const popover =
    open && mounted
      ? createPortal(
          <div ref={popRef} className="zx-statswidget-pop">
            <div className="zx-statswidget-head">
              <span className="zx-mono zx-muted">{'// VISITOR STATS'}</span>
              <button type="button" className="zx-statswidget-close" onClick={() => setOpen(false)} aria-label="关闭">
                ✕
              </button>
            </div>
            <div className="zx-statswidget-grid">
              <Cell label="总访问" value={fmtCompact(visits.pv)} />
              <Cell label="独立访客" value={fmtCompact(visits.uv)} />
              <Cell label="今日访问" value={fmtInt(visits.today.pv)} />
              <Cell label="今日访客" value={fmtInt(visits.today.uv)} />
              <Cell label="在线" value={fmtInt(visits.online)} />
            </div>
            <div className="zx-statswidget-trend">
              {visits.days.map((d) => (
                <div
                  key={d.day}
                  className={`zx-bar${d.pv === 0 ? ' is-zero' : ''}`}
                  data-label={`${d.day.slice(5)} · PV ${d.pv} / UV ${d.uv}`}
                  style={{ height: `${Math.max(3, (d.pv / maxPv) * 100)}%` }}
                />
              ))}
            </div>
            <div className="zx-statswidget-foot zx-muted zx-mono">近 30 天 · 访问量(PV)</div>
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
        onClick={() => setOpen((o) => !o)}
        title="访客统计"
      >
        <span className="zx-envdot" />
        <span className="zx-mono">PV {fmtCompact(visits.pv)}</span>
        <span className="zx-statswidget-sep">·</span>
        <span className="zx-mono zx-muted">在线 {visits.online}</span>
      </button>
      {popover}
    </>
  )
}
