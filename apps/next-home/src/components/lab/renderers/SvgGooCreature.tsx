'use client'

/**
 * 渲染器 2 —— SVG + 液态 metaball 滤镜。
 *
 * 与渲染器 1 **同一套几何**,只换「怎么让它看起来在动」:躯干与肢体互相重叠,
 * 经 `feGaussianBlur` + 高对比 `feColorMatrix` 融成一坨连续的液体,再叠一层
 * `feTurbulence` + `feDisplacementMap` 做有机扰动。这是同一份 DNA 的第二种
 * 运动语言 —— 1 是机械的扇动,2 是黏稠的流动。
 *
 * 两个实测坑(都已在实现里避开):
 *  - **滤镜里的动画只在「内联 SVG」里跑**。塞进 `<img>` 或 data-URI 后
 *    `feTurbulence` 的 baseFrequency 动画直接不执行 —— 所以这里坚持内联渲染。
 *  - `baseFrequency` / `scale` 不是 CSS 表现属性,**没法用 CSS 动画驱动**,
 *    必须用 SMIL(`<animate>`)。CSS 只负责元素级的浮动与整体旋转。
 *
 * 代价:两串滤镜链在 60fps 下不便宜(比渲染器 1 贵一截),且滤镜区域越大越慢。
 */

import { useId, useMemo, useRef } from 'react'
import type { CreatureDna } from '@zx/shared/creature'
import { ARCH_STYLE, buildSpine, buildLimbs, eyePos, useCreatureLoop, ribbon, taper, r } from './shared'

export interface SvgGooCreatureProps {
  dna: CreatureDna
  box?: number
  embedded?: boolean
}

/** 每个原型一个 SMIL 扰动节奏:水母慢而黏,机械快而脆 */
const WARP_SEED: Record<string, number> = {
  orb: 3,
  fish: 11,
  butterfly: 19,
  dragon: 23,
  insect: 5,
  bird: 29,
  plant: 37,
  machine: 41,
}

export function SvgGooCreature({ dna, box = 190, embedded = false }: SvgGooCreatureProps) {
  const uid = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const rootRef = useRef<SVGGElement | null>(null)
  const bodyRef = useRef<SVGPathElement | null>(null)
  const eyeRef = useRef<SVGCircleElement | null>(null)
  const blurRef = useRef<SVGFEGaussianBlurElement | null>(null)
  const dispRef = useRef<SVGFEDisplacementMapElement | null>(null)
  const limbRefs = useRef<(SVGPathElement | null)[]>([])

  const limbCount = dna.shape.limbPairs * 2
  const limbSlots = useMemo(() => new Array<null>(limbCount).fill(null), [limbCount])
  const seed = WARP_SEED[dna.archetype] ?? 17

  useCreatureLoop(dna, (form, ts) => {
    const svg = svgRef.current
    const root = rootRef.current
    if (!svg || !root) return

    const spine = buildSpine(form)
    const ls = buildLimbs(form, spine)
    const st = ARCH_STYLE[form.archetype]

    const span = Math.max(1, form.size * (Math.max(1, st.limbLen) + 0.75) * 2)
    const half = span / 2
    // 滤镜区域要留出位移余量,否则边缘会被裁掉
    const pad = span * 0.12
    svg.setAttribute(
      'viewBox',
      `${r(-half - pad)} ${r(-half - pad)} ${r(span + pad * 2)} ${r(span + pad * 2)}`,
    )

    // --- 滤镜强度随成长加深:越大越「化开」 ---
    const blurPx = Math.min(7, Math.max(0.7, form.size * 0.11 + form.glow * 2.2))
    blurRef.current?.setAttribute('stdDeviation', blurPx.toFixed(2))
    // 位移量跟着体型走,再叠加一点脉动
    const disp = form.size * 0.09 * (1 + 0.35 * Math.sin(ts * 1.3) + form.glow * 0.6)
    dispRef.current?.setAttribute('scale', Math.max(0, disp).toFixed(2))

    // --- 几何(同渲染器 1)---
    bodyRef.current?.setAttribute('d', ribbon(spine, 1))
    const eye = eyePos(form, spine)
    if (eyeRef.current) {
      eyeRef.current.setAttribute('cx', String(r(eye.x)))
      eyeRef.current.setAttribute('cy', String(r(eye.y)))
      eyeRef.current.setAttribute('r', String(r(Math.max(0.8, eye.r * 0.75))))
    }

    for (let i = 0; i < limbCount; i++) {
      const el = limbRefs.current[i]
      if (!el) continue
      const L = ls[i]
      if (!L) {
        el.setAttribute('d', '')
        continue
      }
      const sign = L.side === 0 ? 1 : L.side
      // 液态路线下肢体更粗更短,融合感才连得上
      el.setAttribute('d', taper(L.w * 0.72, L.w * 0.3, (L.bx - L.ax) * sign, L.by - L.ay))
      const g = el.parentElement
      if (g) {
        g.setAttribute('transform', `translate(${r(L.ax)} ${r(L.ay)})`)
        const gs = g.style
        gs.setProperty('--cl-side', String(sign))
        gs.setProperty('--cl-i', String(L.i))
        // 肢体摆动幅度比 SVG 路线大:液体甩得动
        gs.setProperty('--cl-swing', (st.limbAngle * 0.85).toFixed(2))
        gs.setProperty('--cl-limb-dur', `${(1 / Math.max(0.4, form.flapHz * 0.72)).toFixed(3)}s`)
      }
    }

    if (!embedded && form.spin > 0.01) {
      root.setAttribute('transform', `rotate(${r(Math.sin(ts * 0.35) * form.spin * 11)})`)
    } else if (root.hasAttribute('transform')) {
      root.removeAttribute('transform')
    }
  })

  const pal = dna.palette

  return (
    <svg ref={svgRef} className="cl-svg" width={box} height={box} viewBox="-120 -120 240 240" aria-hidden>
      <defs>
        {/* 融合:模糊后把 alpha 阈值拉起来,重叠处并成一块 */}
        <filter id={`goo${uid}`} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
          <feGaussianBlur ref={blurRef} in="SourceGraphic" stdDeviation="3" result="b" />
          <feColorMatrix
            in="b"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10"
            result="g"
          />
        </filter>
        {/* 有机扰动:噪声当位移图。baseFrequency/scale 只能靠 SMIL 动画 */}
        <filter id={`warp${uid}`} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018"
            numOctaves="2"
            seed={seed}
            result="t"
          >
            <animate
              attributeName="baseFrequency"
              values="0.012;0.038;0.02;0.045;0.012"
              dur="9s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap
            ref={dispRef}
            in="SourceGraphic"
            in2="t"
            scale="6"
            xChannelSelector="R"
            yChannelSelector="G"
          >
            <animate
              attributeName="scale"
              values="3;13;5;11;3"
              dur="11s"
              repeatCount="indefinite"
            />
          </feDisplacementMap>
        </filter>
      </defs>

      {/* 两串滤镜串联:先融(goo)再扰(warp) */}
      <g ref={rootRef} filter={`url(#goo${uid}) url(#warp${uid})`}>
        <g className="cl-bob">
          <g className="cl-limbs">
            {limbSlots.map((_, i) => (
              <g key={i} className="cl-limb-g cl-limb-swing">
                <path
                  ref={(el) => {
                    limbRefs.current[i] = el
                  }}
                  className="cl-limb"
                  fill={pal.accent}
                />
              </g>
            ))}
          </g>
          <path ref={bodyRef} className="cl-body" fill={pal.body} />
          <circle ref={eyeRef} className="cl-eye" r="3" fill="#04060a" />
        </g>
      </g>
    </svg>
  )
}
