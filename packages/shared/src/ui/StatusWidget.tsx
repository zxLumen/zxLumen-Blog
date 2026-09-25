'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOAT_MARGIN, snapEdge } from './floating.js'
import { useBarTooltip } from './BarTooltip.js'

interface ServerStatus {
  ok: boolean
  cpu?: number
  mem?: number
  disk?: number
  load?: number
  uptimeSec?: number
  siteUp?: boolean
  trend?: { day: string; cpu: number }[]
  at?: number
}

const POS_KEY = 'zx-status-pos'

const fmtPct = (v?: number) => (v == null ? '—' : `${v.toFixed(0)}%`)

const fmtUptime = (s?: number) => {
  if (s == null) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}d${h}h` : `${h}h`
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="zx-statuswidget-cell">
      <div className="zx-statuswidget-val">{value}</div>
      <div className="zx-statuswidget-lbl">{label}</div>
    </div>
  )
}

/** 右上角悬浮「服务器状态」:可拖动 + 边缘吸附;悬停展开指标 + 近 7 天 CPU 趋势 */
export function StatusWidget() {
  const [data, setData] = useState<ServerStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const barTip = useBarTooltip()
  const ref = useRef<HTMLDivElement>(null)
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

  // 拉取状态(每 60s)
  useEffect(() => {
    let alive = true
    const load = () => {
      fetch('/api/status', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: ServerStatus | null) => {
          if (alive && d) setData(d)
        })
        .catch(() => {
          /* ignore */
        })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

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

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  // 拖动 + 释放时边缘吸附
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      d.moved = true
      const el = ref.current
      const w = el?.offsetWidth ?? 120
      const h = el?.offsetHeight ?? 28
      const x = Math.min(Math.max(FLOAT_MARGIN, e.clientX - d.dx), window.innerWidth - w - FLOAT_MARGIN)
      const y = Math.min(Math.max(FLOAT_MARGIN, e.clientY - d.dy), window.innerHeight - h - FLOAT_MARGIN)
      setPos({ x, y })
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      if (d?.moved) {
        setPos((p) => {
          if (!p) return p
          const el = ref.current
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

  if (!data?.ok) return null

  const trend = data.trend ?? []
  const maxCpu = Math.max(1, ...trend.map((t) => t.cpu))
  const up = data.siteUp !== false
  const style = pos ? { left: pos.x, top: pos.y, right: 'auto' as const } : undefined

  return (
    <div
      ref={ref}
      className={`zx-statuswidget${open ? ' is-open' : ''}`}
      style={style}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={`zx-statuswidget-btn${open ? ' is-open' : ''}`}
        title="服务器状态(可拖动)"
        onPointerDown={(e) => {
          const el = ref.current
          if (!el) return
          const r = el.getBoundingClientRect()
          dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }
        }}
        onMouseEnter={() => {
          cancelClose()
          setOpen(true)
        }}
      >
        <span className="zx-statuswidget-dot" style={{ background: up ? '#37b24d' : '#ff6b6b' }} />
        <span>CPU {fmtPct(data.cpu)}</span>
        <span className="zx-statswidget-sep">·</span>
        <span className="zx-muted">内存 {fmtPct(data.mem)}</span>
      </button>
      {open && (
        <div className="zx-statuswidget-pop" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <div className="zx-statuswidget-head">
            <span className="zx-mono zx-muted">{'// SERVER STATUS'}</span>
            <span className="zx-mono" style={{ color: up ? '#37b24d' : '#ff6b6b' }}>
              {up ? '在线' : '异常'}
            </span>
          </div>
          <div className="zx-statuswidget-grid">
            <Cell label="CPU" value={fmtPct(data.cpu)} />
            <Cell label="内存" value={fmtPct(data.mem)} />
            <Cell label="磁盘 /" value={fmtPct(data.disk)} />
            <Cell label="负载(1m)" value={data.load == null ? '—' : data.load.toFixed(2)} />
            <Cell label="运行时长" value={fmtUptime(data.uptimeSec)} />
            <Cell label="站点" value={up ? '正常' : '异常'} />
          </div>
          <div
            className="zx-statuswidget-trend"
            onMouseMove={barTip.onMouseMove}
            onMouseLeave={barTip.onMouseLeave}
          >
            {trend.map((d) => (
              <div
                key={d.day}
                className={`zx-bar${d.cpu === 0 ? ' is-zero' : ''}`}
                data-label={`${d.day.slice(5)} · CPU ${d.cpu}%`}
                style={{ height: `${Math.max(3, (d.cpu / maxCpu) * 100)}%` }}
              />
            ))}
          </div>
          {barTip.node}
          <div className="zx-statuswidget-foot zx-muted zx-mono">近 7 天 · CPU 日均</div>
        </div>
      )}
    </div>
  )
}
