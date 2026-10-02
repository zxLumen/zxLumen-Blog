'use client'

/**
 * 渲染器 4 —— Canvas 2D Verlet 软体。
 *
 * 手法:一套**固定拓扑**的质点 + 距离约束,位置积分用 Verlet(隐式速度,天然稳定、
 * 不需要额外写速度项)。躯干节点用弹簧拉向骨架目标点(所以整体仍然"是那只生物"),
 * 肢体末端只有长度约束 + 一个很弱的回位弹簧 —— 于是它会甩、会抖、会拖。
 *
 * 与 1/2/3 的性格差异:**有质量、会下垂、有惯性**,最"物理",也最能显出性格:
 * 水母飘、萤火虫抖、机器几乎不晃(刚度由 DNA 决定)。
 *
 * 为什么用 Verlet 而不是显式力 + 半隐式欧拉:软体在 60fps 下最容易炸的是
 * 高刚度弹簧的稳定性。Verlet 的位置式约束投影天然抗抖,代价是能量不守恒、
 * 高速时发虚 —— 这里的速度都很低,完全够用。
 */

import { useRef } from 'react'
import type { CreatureDna } from '@zx/shared/creature'
import {
  buildSpine,
  buildLimbs,
  useCreatureLoopWith,
  fitCanvas,
  weightOf,
  stiffnessOf,
  agitationOf,
} from './shared'

interface Node {
  x: number
  y: number
  px: number
  py: number
  /** 目标点(弹簧拉向它) */
  tx: number
  ty: number
  /** 该点的显示半宽 */
  w: number
  /** 是否为躯干主链 */
  spine: boolean
}

interface Edge {
  a: number
  b: number
  len: number
  /** 刚度系数:1 = 完全刚性约束 */
  stiff: number
}

interface Topology {
  nodes: Node[]
  edges: Edge[]
  limbs: { a: number; b: number; w: number }[]
  bodyChain: number[]
}

const BODY_N = 9
const ITER = 4

export interface VerletCreatureProps {
  dna: CreatureDna
  box?: number
}

/** 建一套拓扑:只跟 shape 有关(肢对数 / 体节数),成长过程不改它,所以只建一次 */
function makeTopology(limbPairs: number): Topology {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const limbs: { a: number; b: number; w: number }[] = []
  const bodyChain: number[] = []

  for (let i = 0; i < BODY_N; i++) {
    bodyChain.push(nodes.length)
    nodes.push({ x: 0, y: 0, px: 0, py: 0, tx: 0, ty: 0, w: 0, spine: true })
  }
    // 主链:相邻点硬约束 + 跨两点的弯曲约束(防止主链被压成 U 形)
  for (let i = 0; i + 1 < BODY_N; i++) {
    edges.push({ a: bodyChain[i], b: bodyChain[i + 1], len: 1, stiff: 1 })
  }
  for (let i = 0; i + 2 < BODY_N; i++) {
    edges.push({ a: bodyChain[i], b: bodyChain[i + 2], len: 2, stiff: 0.32 })
  }

  for (let s = 0; s < limbPairs; s++) {
    for (let side = 0; side < 2; side++) {
      // 附着在主链上,不取头尾(头尾留给触须)
      const anchor = bodyChain[2 + ((s + side) % (BODY_N - 3))]
      const tip = nodes.length
      nodes.push({ x: 0, y: 0, px: 0, py: 0, tx: 0, ty: 0, w: 0, spine: false })
      edges.push({ a: anchor, b: tip, len: 1, stiff: 0.55 })
      limbs.push({ a: anchor, b: tip, w: 1 })
    }
  }

  return { nodes, edges, limbs, bodyChain }
}

export function VerletCreature({ dna, box = 190 }: VerletCreatureProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useCreatureLoopWith(dna, () => makeTopology(dna.shape.limbPairs), (T, form, ts) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    fitCanvas(canvas, ctx, box)

    const c = box / 2
    const k = (box * 0.26) / Math.max(1, form.size)
    const weight = weightOf(form.traits)
    const stiff = stiffnessOf(form.traits)
    const agit = agitationOf(form.traits)

    const spine = buildSpine(form)
    const ls = buildLimbs(form, spine)

    // 整体锚点:上下浮 + 漂移 + 自旋(和 SVG 路线同一个源,保证六张卡动得一致)
    const bob = Math.sin(ts * 1.6 + 0.4) * form.bobPx * k * 2.4
    const ax = c + Math.sin(ts * 0.31) * form.driftAmp * k * 1.6
    const ay = c + bob
    const spin = Math.sin(ts * 0.45) * form.spin * 0.24

    /* ---- 重设目标点 ---- */
    for (let i = 0; i < BODY_N; i++) {
      const t = i / (BODY_N - 1)
      const sp = spine[Math.min(spine.length - 1, Math.round(t * (spine.length - 1)))]
      const n = T.nodes[T.bodyChain[i]]
      n.tx = ax + (sp.x * Math.cos(spin) - sp.y * Math.sin(spin)) * k
      n.ty = ay + (sp.x * Math.sin(spin) + sp.y * Math.cos(spin)) * k
      n.w = Math.max(0.7, sp.w * k)
    }
    for (let i = 0; i < T.limbs.length; i++) {
      const L = ls[i]
      const n = T.nodes[T.limbs[i].b]
      const m = T.limbs[i]
      if (!L) {
        n.tx = n.x
        n.ty = n.y
        continue
      }
      m.w = L.w * k
      const sign = L.side === 0 ? 1 : L.side
      const bx = L.bx * sign
      const by = L.by
      n.tx = ax + (bx * Math.cos(spin) - by * Math.sin(spin)) * k
      n.ty = ay + (bx * Math.sin(spin) + by * Math.cos(spin)) * k
      n.w = Math.max(0.5, L.w * 0.3 * k)
    }

    /* ---- Verlet 积分 ---- */
    // 刚度来自性格:轻飘的几乎不受力,沉重的贴住目标
    const gravity = 0.02 + weight * 0.16
    const damping = 0.9 + stiff * 0.075
    // 躁动越高,自发的呼吸抖动越大(机械体几乎完全不动)
    const tremor = agit * 0.35 * k * 0.02
    for (const n of T.nodes) {
      if (n.x === 0 && n.y === 0 && n.px === 0 && n.py === 0) {
        // 首帧直接落到目标点,否则会看到"从原点飞过来"
        n.x = n.tx
        n.y = n.ty
        n.px = n.tx
        n.py = n.ty
      }
      const vx = (n.x - n.px) * damping
      const vy = (n.y - n.py) * damping
      n.px = n.x
      n.py = n.y
      n.x += vx + Math.sin(ts * 5.3 + n.w) * tremor
      n.y += vy + gravity + Math.cos(ts * 4.7 + n.w) * tremor
    }

    /* ---- 约束投影 ---- */
    // 弹簧回位:躯干拉得比较紧,肢体只轻轻回位 → 甩动
    for (const n of T.nodes) {
      const kk = n.spine ? 0.18 + stiff * 0.16 : 0.03 + stiff * 0.02
      n.x += (n.tx - n.x) * kk
      n.y += (n.ty - n.y) * kk
    }
    for (let it = 0; it < ITER; it++) {
      for (const e of T.edges) {
        const a = T.nodes[e.a]
        const b = T.nodes[e.b]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d < 1e-4) continue
        // 目标长度按当前目标点间距实时算 —— 成长时躯干变长,约束跟着放长
        const want = Math.max(1, Math.hypot(b.tx - a.tx, b.ty - a.ty))
        const diff = ((d - want) / d) * e.stiff * 0.5
        const ox = dx * diff
        const oy = dy * diff
        a.x += ox
        a.y += oy
        b.x -= ox
        b.y -= oy
      }
    }

    /* ---- 绘制 ---- */
    ctx.clearRect(0, 0, box, box)

    // 肢体在后、躯干在前,重叠处才不会露缝
    ctx.lineCap = 'round'
    for (const m of T.limbs) {
      const a = T.nodes[m.a]
      const b = T.nodes[m.b]
      ctx.strokeStyle = form.palette.accent
      ctx.globalAlpha = 0.65 + form.glow * 0.3
      ctx.lineWidth = Math.max(0.8, m.w * 0.9)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      // 末端一点亮,像发光器官
      ctx.globalAlpha = 0.5 + form.glow * 0.4
      ctx.fillStyle = form.palette.glow
      ctx.beginPath()
      ctx.arc(b.x, b.y, Math.max(0.9, b.w * 1.6), 0, Math.PI * 2)
      ctx.fill()
    }

    // 躯干:沿主链画一串相邻圆(比多边形路径更软,且天然闭合感)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < BODY_N; i++) {
        const n = T.nodes[T.bodyChain[i]]
        const isHead = i === 0
        ctx.fillStyle = isHead ? form.palette.accent : form.palette.body
        ctx.globalAlpha = pass === 0 ? 1 : 0.3 + form.glow * 0.4
        ctx.beginPath()
        ctx.ellipse(n.x, n.y, Math.max(1, n.w * (pass === 0 ? 1 : 2.1)), Math.max(1, n.w * (pass === 0 ? 0.86 : 1.9)), 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 眼:跟头节点
    const head = T.nodes[T.bodyChain[0]]
    ctx.globalAlpha = 1
    ctx.fillStyle = form.palette.glow
    ctx.beginPath()
    ctx.arc(head.x + head.w * 0.35, head.y - head.w * 0.3, Math.max(1.1, head.w * 0.34), 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 1
  })

  return (
    <canvas
      ref={canvasRef}
      className="cl-canvas"
      width={box}
      height={box}
      style={{ width: box, height: box }}
      aria-hidden
    />
  )
}