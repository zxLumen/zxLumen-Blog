'use client'

import { useId, useMemo, useRef, useState } from 'react'

export interface SparkPoint {
  /** Unix 秒 */
  t: number
  v: number
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * 极简 SVG 折线图(用于悬浮件):自适应宽度、0→峰值、淡色面积 + hover 最近点提示。
 * 用 `preserveAspectRatio="none"` 拉满宽度,配 `vector-effect:non-scaling-stroke` 防线条变形。
 */
export function Sparkline({
  points,
  height = 64,
  stroke = 'var(--accent)',
  formatValue = (v) => String(Math.round(v * 10) / 10),
  formatTime = (t) =>
    new Date(t * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
}: {
  points: SparkPoint[]
  height?: number
  stroke?: string
  formatValue?: (v: number) => string
  formatTime?: (t: number) => string
}) {
  const gradId = useId().replace(/[:]/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const geo = useMemo(() => {
    const n = points.length
    if (n === 0) return null
    const padY = 6
    const maxV = Math.max(1, ...points.map((p) => p.v))
    const xOf = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)
    const yOf = (v: number) => height - padY - (clamp(v, 0, maxV) / maxV) * (height - padY * 2)
    const pts = points.map((p, i) => [xOf(i), yOf(p.v)] as const)
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
    const area = `${line} L100,${height} L0,${height} Z`
    return { n, maxV, pts, line, area }
  }, [points, height])

  if (!geo) {
    return (
      <div className="zx-spark zx-spark-empty" style={{ height }}>
        <span className="zx-muted zx-mono">无数据</span>
      </div>
    )
  }

  const { n, pts, line, area } = geo
  const hv = hover != null ? pts[hover] : null
  const hp = hover != null ? points[hover] : null

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    setHover(n === 1 ? 0 : Math.round(ratio * (n - 1)))
  }

  return (
    <div
      ref={wrapRef}
      className="zx-spark"
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="zx-spark-svg" aria-hidden="true">
        <defs>
          <linearGradient id={`zxspark-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#zxspark-${gradId})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hv && (
          <>
            <line
              x1={hv[0]}
              y1={0}
              x2={hv[0]}
              y2={height}
              stroke="var(--fg-muted)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              opacity="0.5"
            />
            <circle cx={hv[0]} cy={hv[1]} r="2.4" fill={stroke} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hp && hv && (
        <div
          className="zx-spark-tip zx-mono"
          style={{ left: `${clamp(pts[hover!][0], 6, 94)}%` }}
        >
          {formatTime(hp.t)} · {formatValue(hp.v)}
        </div>
      )}
    </div>
  )
}
