'use client'

/**
 * 渲染器 3 —— Canvas 2D 流场 + 拖尾缓冲。
 *
 * 手法:一块**不退画的画布**,每帧用 `destination-out` 整体淡出一点点,再叠加新画的
 * 线段 —— 于是自然形成有长度的拖尾。粒子不是乱飘:每个粒子认领骨架上的一个
 * 「家」(attractor),速度 = 回家力 + 旋度流场力 的混合,所以整体轮廓始终是那只生物,
 * 而场让它显得在液体里流动。
 *
 * 与 1/2 的性格差异:**有机、飘、不可预测**,但也最不像「一个东西」。
 * 代价:拖尾缓冲在高分屏上要按 DPR 放大,淡出用半透明叠加会累积色偏(已用
 * `destination-out` 规避)。
 */

import { useEffect, useRef } from 'react'
import type { CreatureDna } from '@zx/shared/creature'
import { buildSpine, buildLimbs, useCreatureLoop, fitCanvas } from './shared'

interface Particle {
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  /** 认领的骨架点索引 */
  home: number
  life: number
}

export interface FlowFieldCreatureProps {
  dna: CreatureDna
  box?: number
}

const MAX_P = 700

/**
 * 旋度流场:几组 sin/cos 的错位和。
 *
 * 提到模块级是因为它在每帧被调用上千次 —— 放循环体里等于每帧重建上千个闭包。
 * 返回的是"近似旋度"(场本身的旋转),所以粒子会打旋而不是直奔一个方向。
 */
function fieldAt(x: number, y: number, t: number): [number, number] {
  const a1 = Math.sin(x * 0.014 + t * 0.55) * Math.cos(y * 0.012 - t * 0.4)
  const b1 = Math.sin((x + y) * 0.009 + t * 0.31)
  return [a1 + b1 * 0.6, b1 - a1 * 0.6]
}

export function FlowFieldCreature({ dna, box = 190 }: FlowFieldCreatureProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const parts = useRef<Particle[]>([])
  const homes = useRef<{ x: number; y: number; w: number }[]>([])

  useEffect(() => {
    parts.current = Array.from({ length: MAX_P }, () => ({
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      vx: 0,
      vy: 0,
      home: 0,
      life: 0,
    }))
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, box, box)
  }, [box])

  useCreatureLoop(dna, (form, ts) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    fitCanvas(canvas, ctx, box)

    const c = box / 2
    // 让不同阶段的体型都占据画布的相近比例,否则小形态会缩成一点看不见
    const k = (box * 0.3) / Math.max(1, form.size)
    const spine = buildSpine(form)
    const ls = buildLimbs(form, spine)

    /* ---- 骨架采样点(每帧重算:生物在长大,家也在移动) ---- */
    const h: { x: number; y: number; w: number }[] = []
    for (const p of spine) {
      h.push({ x: c + p.x * k, y: c + p.y * k, w: p.w * k })
    }
    for (const L of ls) {
      const steps = 3
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        h.push({
          x: c + (L.ax + (L.bx - L.ax) * t) * k,
          y: c + (L.ay + (L.by - L.ay) * t) * k,
          w: L.w * 0.5 * k * (1 - t * 0.6),
        })
      }
    }
    if (h.length < 4) return
    homes.current = h

    /* ---- 拖尾缓冲:整体淡出 ---- */
    // 淡出速度与 trail 强度挂钩 —— 拖尾越长,残留越多
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = `rgba(0,0,0,${(0.035 + form.trail * 0.09).toFixed(3)})`
    ctx.fillRect(0, 0, box, box)

    /* ---- 叠加绘制 ---- */
    ctx.globalCompositeOperation = 'lighter'

    // 底层:很淡的躯干轮廓,帮轮廓成形(否则纯粒子认不出是只什么)
    ctx.globalAlpha = 0.1 + form.glow * 0.1
    ctx.fillStyle = form.palette.body
    ctx.beginPath()
    for (let i = 0; i < spine.length; i++) {
      const p = spine[i]
      const w = Math.max(0.6, p.w * k)
      const px = c + p.x * k
      const py = c + p.y * k
      ctx.ellipse(px, py, w, w * 0.72, p.ang, 0, Math.PI * 2)
    }
    ctx.fill()
    for (const L of ls) {
      ctx.beginPath()
      ctx.moveTo(c + L.ax * k, c + L.ay * k)
      ctx.lineTo(c + L.bx * k, c + L.by * k)
      ctx.lineWidth = Math.max(0.8, L.w * k * 0.9)
      ctx.lineCap = 'round'
      ctx.strokeStyle = form.palette.accent
      ctx.stroke()
    }

    /* ---- 粒子 ---- */
    const active = Math.round(
      90 + form.glow * 180 + form.trail * 220 + form.stage * 40,
    )
    const pull = 0.1 + (1 - form.trail) * 0.1 // 拖尾越强,越少「回家」、越多自由流动
    const fieldK = 0.5 + form.trail * 1.6
    const glowCol = form.palette.glow
    const accentCol = form.palette.accent

    ctx.lineCap = 'round'
    for (let i = 0; i < active; i++) {
      const p = parts.current[i]
      if (!p) continue
      const home = homes.current[p.home % homes.current.length]
      if (!home) continue

      if (p.life <= 0) {
        // 重生:从家附近散开,带一点随机初速
        const a = (i * 2.39996 + ts) % (Math.PI * 2)
        const rad = home.w * (0.6 + Math.random() * 2.4)
        p.x = home.x + Math.cos(a) * rad
        p.y = home.y + Math.sin(a) * rad
        p.vx = Math.cos(a) * 0.4
        p.vy = Math.sin(a) * 0.4
        p.home = i % homes.current.length
        p.life = 20 + Math.random() * 50
      }

      p.px = p.x
      p.py = p.y

      // 回家力
      let dx = home.x - p.x
      let dy = home.y - p.y
      const dl = Math.hypot(dx, dy) || 1
      dx /= dl
      dy /= dl
      const accHome = dl * 0.045 * pull * 60

      const [fx, fy] = fieldAt(p.x, p.y, ts)

      p.vx += (dx * accHome + fx * fieldK) * 0.16
      p.vy += (dy * accHome + fy * fieldK) * 0.16
      // 阻尼 + 速度上限(限速很重要:否则场能把粒子甩出画布)
      const damp = 0.9 - form.trail * 0.06
      p.vx *= damp
      p.vy *= damp
      const sp = Math.hypot(p.vx, p.vy)
      const cap = 1.6 + form.trail * 2.4
      if (sp > cap) {
        p.vx = (p.vx / sp) * cap
        p.vy = (p.vy / sp) * cap
      }

      p.x += p.vx
      p.y += p.vy
      p.life--

      // 出界或飞太远就重生,避免粒子堆积在边缘
      if (p.x < -8 || p.x > box + 8 || p.y < -8 || p.y > box + 8 || dl > box * 1.4) {
        p.life = 0
        continue
      }

      const fade = Math.min(1, p.life / 26)
      ctx.globalAlpha = 0.5 * fade * (0.4 + form.glow * 0.6)
      ctx.strokeStyle = i % 3 === 0 ? accentCol : glowCol
      ctx.lineWidth = Math.max(0.5, Math.min(2.1, home.w * 0.28))
      ctx.beginPath()
      ctx.moveTo(p.px, p.py)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
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
