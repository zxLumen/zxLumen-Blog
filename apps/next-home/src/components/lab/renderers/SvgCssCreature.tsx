'use client'

/**
 * 渲染器 1 —— SVG + CSS keyframes。
 *
 * 分工:**几何来自 JS**(每帧重算 `d`),**缓动与时序来自 CSS**(扇动 / 浮动 / 辉光脉冲
 * 都是 `@keyframes` 无限循环,JS 只写自定义属性)。这是纯 SVG 路线最省电的做法 ——
 * 只动 transform/opacity,交给合成器,主线程不做布局。
 *
 * 性能要点:DOM 骨架只在挂载时建一次 —— 肢体数量 = `shape.limbPairs × 2`,由 DNA
 * 决定、天生不随成长变化。之后每帧只 `setAttribute`,**完全不走 React 调和**。
 */

import { useId, useMemo, useRef } from 'react'
import type { CreatureDna } from '@zx/shared/creature'
import {
  ARCH_STYLE,
  buildSpine,
  buildLimbs,
  eyePos,
  useCreatureLoop,
  ribbon,
  taper,
  r,
} from './shared'

const TRAIL_N = 7

export interface SvgCssCreatureProps {
  dna: CreatureDna
  /** 画布边长(px) */
  box?: number
  /** 群飞模式:整体漂移交给外层定位,本体只做自旋 */
  embedded?: boolean
}

export function SvgCssCreature({ dna, box = 190, embedded = false }: SvgCssCreatureProps) {
  const uid = useId().replace(/:/g, '')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const rootRef = useRef<SVGGElement | null>(null)
  const bodyRef = useRef<SVGPathElement | null>(null)
  const eyeRef = useRef<SVGCircleElement | null>(null)
  const limbRefs = useRef<(SVGPathElement | null)[]>([])
  const trailRefs = useRef<(SVGCircleElement | null)[]>([])

  // 肢体对数是 DNA 常量,成长过程里不变 —— 所以骨架只建一次
  const limbCount = Math.max(0, dna.shape.limbPairs) * 2
  const limbSlots = useMemo(() => new Array<null>(limbCount).fill(null), [limbCount])
  const trailSlots = useMemo(() => new Array<null>(TRAIL_N).fill(null), [])

  useCreatureLoop(dna, (form, ts) => {
    const svg = svgRef.current
    const root = rootRef.current
    if (!svg || !root) return

    const spine = buildSpine(form)
    const ls = buildLimbs(form, spine)
    const st = ARCH_STYLE[form.archetype]

    // 画布随成长缩放:viewBox 跟着收缩,等于等比放大
    const span = Math.max(1, form.size * (Math.max(1, st.limbLen) + 0.55) * 2)
    const half = span / 2
    svg.setAttribute('viewBox', `${r(-half)} ${r(-half)} ${r(span)} ${r(span)}`)

    // --- 自定义属性:节拍与幅度交给 CSS ---
    const s = svg.style
    s.setProperty('--cl-flap-dur', `${(1 / Math.max(0.4, form.flapHz)).toFixed(3)}s`)
    s.setProperty('--cl-flap-d', (0.14 + form.glow * 0.22).toFixed(3))
    s.setProperty('--cl-wing-a', (st.limbAngle * 0.5).toFixed(2))
    s.setProperty('--cl-bob-amt', `${r(form.bobPx)}px`)
    s.setProperty('--cl-glow', form.glow.toFixed(3))
    s.setProperty('--cl-bob-dur', `${(2.4 / (1 + form.stage * 0.35)).toFixed(2)}s`)
    s.setProperty('--cl-breath-dur', `${(1.9 / (1 + form.stage * 0.3)).toFixed(2)}s`)

    // --- 几何 ---
    bodyRef.current?.setAttribute('d', ribbon(spine))
    const eye = eyePos(form, spine)
    if (eyeRef.current) {
      eyeRef.current.setAttribute('cx', String(r(eye.x)))
      eyeRef.current.setAttribute('cy', String(r(eye.y)))
      eyeRef.current.setAttribute('r', String(r(eye.r)))
    }

    for (let i = 0; i < limbCount; i++) {
      const el = limbRefs.current[i]
      if (!el) continue
      const L = ls[i]
      if (!L) {
        el.setAttribute('d', '')
        continue
      }
      // 局部坐标:附着点由父 <g> 平移,路径自身在 CSS 里绕 0,0 扇动
      const sign = L.side === 0 ? 1 : L.side
      el.setAttribute('d', taper(L.w * 0.5, L.w * 0.16, (L.bx - L.ax) * sign, L.by - L.ay))
      const g = el.parentElement
      if (g) {
        g.setAttribute('transform', `translate(${r(L.ax)} ${r(L.ay)})`)
        const gs = g.style
        gs.setProperty('--cl-side', String(sign))
        gs.setProperty('--cl-i', String(L.i))
        gs.setProperty('--cl-limb-op', (0.5 + form.glow * 0.45).toFixed(3))
        gs.setProperty('--cl-limb-w', String(r(L.w)))
      }
    }

    // --- 拖尾:沿正弦游走的一串淡点,个数与亮度由 form.trail 决定 ---
    const tn = Math.round(form.trail * TRAIL_N)
    for (let i = 0; i < TRAIL_N; i++) {
      const el = trailRefs.current[i]
      if (!el) continue
      const k = (i + 1) / TRAIL_N
      el.setAttribute('cx', String(r(Math.sin(ts * 1.1 - i * 0.42) * form.driftAmp * k)))
      el.setAttribute('cy', String(r(Math.cos(ts * 0.8 - i * 0.31) * form.driftAmp * 0.5 * k)))
      el.setAttribute('r', String(r(form.size * 0.1 * (1 - k * 0.6))))
      el.style.opacity =
        i < tn ? (0.5 * (1 - k) * (0.35 + form.glow * 0.65)).toFixed(3) : '0'
    }

    // --- 自旋:SVG 里最贵的一项,只在真的需要时开 ---
    if (!embedded && form.spin > 0.01) {
      root.setAttribute('transform', `rotate(${r(Math.sin(ts * 0.45) * form.spin * 14)})`)
    } else if (root.hasAttribute('transform')) {
      root.removeAttribute('transform')
    }
  })

  const pal = dna.palette

  return (
    <svg ref={svgRef} className="cl-svg" width={box} height={box} viewBox="-100 -100 200 200" aria-hidden>
      <defs>
        <radialGradient id={`hg${uid}`}>
          <stop offset="0%" stopColor={pal.glow} stopOpacity="0.55" />
          <stop offset="55%" stopColor={pal.glow} stopOpacity="0.16" />
          <stop offset="100%" stopColor={pal.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={pal.body} />
          <stop offset="55%" stopColor={pal.accent} />
          <stop offset="100%" stopColor={pal.body} />
        </linearGradient>
      </defs>

      <g ref={rootRef}>
        {/* 辉光:纯 CSS 脉冲,JS 只给强度 */}
        <ellipse className="cl-halo" fill={`url(#hg${uid})`} rx="60" ry="46" />
        <g className="cl-trail">
          {trailSlots.map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                trailRefs.current[i] = el
              }}
              r="2"
              fill={pal.glow}
              opacity={0}
            />
          ))}
        </g>

        {/* 上下浮动:纯 CSS */}
        <g className="cl-bob">
          <g className="cl-limbs">
            {limbSlots.map((_, i) => (
              <g key={i} className="cl-limb-g">
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
          {/* 躯干:JS 给路径,CSS 给「呼吸」缩放 */}
          <path ref={bodyRef} className="cl-body" fill={`url(#bg${uid})`} />
          <circle ref={eyeRef} className="cl-eye" r="3" />
        </g>
      </g>
    </svg>
  )
}
