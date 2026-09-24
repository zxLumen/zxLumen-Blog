'use client'

import { modelColor, modelLabel } from './constants.js'

export interface DonutDatum {
  model: string
  input: number
  output: number
}

const R_OUT = 43
const R_IN = 26

const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]
}

/** 环形扇区路径(外弧顺时针,内弧逆时针,回填中心) */
function sectorPath(a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0
  const [x0, y0] = polar(R_OUT, a0)
  const [x1, y1] = polar(R_OUT, a1)
  const [x2, y2] = polar(R_IN, a1)
  const [x3, y3] = polar(R_IN, a0)
  return `M ${x0} ${y0} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${R_IN} ${R_IN} 0 ${large} 0 ${x3} ${y3} Z`
}

/**
 * tokens 占比甜甜圈:每块一个 SVG 扇区,hover 时高亮该块(不移动),
 * 模型名由父组件在饼图下方的 caption 显示。
 * `hover`/`onHover` 由父组件持有,便于与图例行联动高亮。
 */
export function Donut({
  data,
  hover,
  onHover,
}: {
  data: DonutDatum[]
  hover: string | null
  onHover: (model: string | null) => void
}) {
  const total = Math.max(1, data.reduce((a, m) => a + m.input + m.output, 0))

  if (data.length === 0)
    return (
      <div className="zx-donut-wrap">
        <div className="zx-donut zx-donut--empty" />
      </div>
    )

  let acc = -90
  const slices = data.map((m) => {
    const a0 = acc
    acc += ((m.input + m.output) / total) * 360
    return { model: m.model, a0, a1: acc }
  })

  return (
    <div className="zx-donut-wrap">
      <svg className="zx-donut" viewBox="0 0 100 100" role="img" aria-label="tokens 占比">
        {slices.length === 1 ? (
          <circle
            className={`zx-donut-slice${hover === slices[0].model ? ' is-active' : ''}`}
            cx="50"
            cy="50"
            r={(R_OUT + R_IN) / 2}
            fill="none"
            stroke={modelColor(slices[0].model)}
            strokeWidth={R_OUT - R_IN}
            onMouseEnter={() => onHover(slices[0].model)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onHover(hover === slices[0].model ? null : slices[0].model)}
          />
        ) : (
          slices.map((s) => {
            const isActive = hover === s.model
            return (
              <path
                key={s.model}
                className={`zx-donut-slice${isActive ? ' is-active' : ''}`}
                d={sectorPath(s.a0, s.a1)}
                fill={modelColor(s.model)}
                aria-label={modelLabel(s.model)}
                onMouseEnter={() => onHover(s.model)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onHover(isActive ? null : s.model)}
              />
            )
          })
        )}
        <circle cx="50" cy="50" r={R_IN} fill="var(--bg-2)" pointerEvents="none" />
      </svg>
    </div>
  )
}
