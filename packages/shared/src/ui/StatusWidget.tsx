'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FLOAT_MARGIN, snapEdge } from './floating.js'
import { Sparkline, type SparkPoint } from './Sparkline.js'

type Metric = 'cpu' | 'mem' | 'disk' | 'load'

interface ServerStatus {
  ok: boolean
  cpu?: number
  mem?: number
  disk?: number
  load?: number
  uptimeSec?: number
  siteUp?: boolean
  series?: Partial<Record<Metric, SparkPoint[]>>
  at?: number
  error?: string
}

const METRICS: { key: Metric; label: string; pct: boolean }[] = [
  { key: 'cpu', label: 'CPU', pct: true },
  { key: 'mem', label: '内存', pct: true },
  { key: 'disk', label: '磁盘 /', pct: true },
  { key: 'load', label: '负载(1m)', pct: false },
]

const POS_KEY = 'zx-status-pos'

const fmtPct = (v?: number) => (v == null ? '—' : `${v.toFixed(0)}%`)
const fmtMetric = (m: { pct: boolean }, v?: number) =>
  v == null ? '—' : m.pct ? `${v.toFixed(0)}%` : v.toFixed(2)

const fmtUptime = (s?: number) => {
  if (s == null) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}d${h}h` : `${h}h`
}

/** 右上角悬浮「服务器状态」:可拖动 + 边缘吸附;悬停展开指标 + 近 24h 折线(按指标切换)。
 *  数据源失败时显示降级气泡(不隐藏),便于发现 nas/token 问题。 */
export function StatusWidget() {
  const [data, setData] = useState<ServerStatus | null>(null)
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle')
  const [errText, setErrText] = useState('')
  const [open, setOpen] = useState(false)
  const [metric, setMetric] = useState<Metric>('cpu')
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
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
          if (!alive) return
          if (d?.ok) {
            setData(d)
            setErrText('')
            setState('ok')
          } else {
            setErrText(d?.error || 'status query failed')
            setState('err')
          }
        })
        .catch(() => {
          if (alive) {
            setErrText('无法连接 /api/status')
            setState('err')
          }
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

  if (state === 'idle') return null

  const ok = state === 'ok' && !!data?.ok
  const up = ok ? data.siteUp !== false : false
  const active = METRICS.find((m) => m.key === metric)!
  const pts = ok ? (data?.series?.[metric] ?? []) : []
  const peak = pts.length ? Math.max(...pts.map((p) => p.v)) : null
  const cur = ok ? data?.[metric] : undefined
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
        <span>{ok ? `CPU ${fmtPct(data?.cpu)}` : '状态异常'}</span>
        {ok && (
          <>
            <span className="zx-statswidget-sep">·</span>
            <span className="zx-muted">内存 {fmtPct(data?.mem)}</span>
          </>
        )}
      </button>
      {open && (
        <div className="zx-statuswidget-pop" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <div className="zx-statuswidget-head">
            <span className="zx-mono zx-muted">{ok ? '// SERVER STATUS' : '// STATUS ERROR'}</span>
            <span className="zx-mono" style={{ color: up ? '#37b24d' : '#ff6b6b' }}>
              {ok ? '在线' : '异常'}
            </span>
          </div>
          {ok ? (
            <>
              <div className="zx-statuswidget-grid">
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`zx-statuswidget-cell${metric === m.key ? ' is-active' : ''}`}
                    aria-pressed={metric === m.key}
                    onClick={() => setMetric(m.key)}
                    title={`查看 ${m.label} 近 24h 曲线`}
                  >
                    <div className="zx-statuswidget-val">{fmtMetric(m, data?.[m.key])}</div>
                    <div className="zx-statuswidget-lbl">{m.label}</div>
                  </button>
                ))}
                <div className="zx-statuswidget-cell">
                  <div className="zx-statuswidget-val">{fmtUptime(data?.uptimeSec)}</div>
                  <div className="zx-statuswidget-lbl">运行时长</div>
                </div>
                <div className="zx-statuswidget-cell">
                  <div className="zx-statuswidget-val">{up ? '正常' : '异常'}</div>
                  <div className="zx-statuswidget-lbl">站点</div>
                </div>
              </div>
              <Sparkline
                points={pts}
                formatValue={(v) => fmtMetric(active, v)}
                stroke="var(--accent)"
              />
              <div className="zx-statuswidget-foot zx-muted zx-mono">
                近 24h · {active.label} · 当前 {fmtMetric(active, cur)} / 峰值{' '}
                {peak == null ? '—' : fmtMetric(active, peak)}
              </div>
            </>
          ) : (
            <div className="zx-statuswidget-err">
              <div className="zx-mono" style={{ color: '#ff6b6b' }}>
                DATA SOURCE UNREACHABLE
              </div>
              <div className="zx-muted zx-mono">{errText || '数据源不可用,状态未知'}</div>
              <div className="zx-statuswidget-foot zx-muted">将持续重试,每 60s 刷新</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
