'use client'

/**
 * 群飞模式:5 只生物在共享时间轴下一起飞。
 *
 * 这里验证的是**空间编排**,不是新渲染技术 —— 复用已有的 SVG/CSS 渲染器,
 * 但刻意换了几件事:
 *  - 每只有独立的相位偏移、缩放与配色(用同一份 preset + 不同 salt 派生)
 *  - 漂浮轨迹各走各的,不能同步平移(同步 = 一眼看假)
 *  - 选中一只时只放大它,其余压暗 —— 用来比较同一时刻的体型差异
 *
 * 性能上只跑 SVG 路线:5 只 × 每帧重算路径,在 lab 里足够流畅;
 * 真正上站时要把 5 只换成粒子/WebGL 版本,这是 lab 要暴露的取舍。
 */

import { useMemo, useState } from 'react'
import type { CreatureDna } from '@zx/shared/creature'
import { PRESET_DESCRIPTIONS, fallbackDna } from '@zx/shared/creature'
import { SvgCssCreature } from './renderers/SvgCssCreature'
import { usePrefersReducedMotion } from './renderers/shared'

const N = 5

interface Flier {
  dna: CreatureDna
  /** 归一化的中心点(0..1),由预设偏移 + 时间推出 */
  ox: number
  oy: number
  scale: number
  phase: number
}

/** 预置里挑 5 个差异最大的原型,避免群飞看起来是同一只的复制 */
const PICKS = [0, 1, 2, 4, 5]

export function SwarmCreature({ box = 190 }: { box?: number }) {
  const reduced = usePrefersReducedMotion()
  const [focus, setFocus] = useState<number | null>(null)

  const fliers = useMemo<Flier[]>(
    () =>
      PICKS.slice(0, N).map((pi, i) => {
        const dna = fallbackDna(PRESET_DESCRIPTIONS[pi], `swarm-${i}`)
        // 黄金角散开:均匀铺开且不需要随机数(可复现)
        const a = (i / N) * Math.PI * 2
        const rad = 0.2 + (i % 2) * 0.09
        return {
          dna,
          ox: 0.5 + Math.cos(a) * rad,
          oy: 0.5 + Math.sin(a) * rad * 0.7,
          scale: 0.82 + (i % 3) * 0.12,
          phase: i * 1.37,
        }
      }),
    [],
  )

  return (
    <div className="cl-swarm" style={{ width: box, height: box }}>
      {fliers.map((f, i) => {
        const dim = focus !== null && focus !== i
        return (
          <button
            key={i}
            type="button"
            className={`cl-swarm-item${focus === i ? ' is-focus' : ''}${dim ? ' is-dim' : ''}`}
            // 百分比与自定义属性都必须「定长字符串」:SSR 与浏览器 hydrate 时
            // 浮点数的序列化结果不一致(26.538507163126518% vs 26.5385%),
            // 会触发 hydration mismatch,整棵树被标记为不一致。
            style={
              {
                left: `${(f.ox * 100).toFixed(2)}%`,
                top: `${(f.oy * 100).toFixed(2)}%`,
                '--cl-phase': String(f.phase.toFixed(2)),
              } as React.CSSProperties
            }
            onClick={() => setFocus(focus === i ? null : i)}
            title={`${f.dna.name} · ${f.dna.archetype}`}
          >
            <span className="cl-swarm-float" style={{ animationDuration: `${7 + (i % 3) * 2.4}s` }}>
              <SvgCssCreature dna={f.dna} box={Math.round(box * 0.52)} embedded />
            </span>
            <span className="cl-swarm-name">{f.dna.name}</span>
          </button>
        )
      })}
      {!reduced && (
        <span className="cl-swarm-hint">
          点一只放大 · {focus !== null ? '再点一次还原' : '5 只共用同一条成长时间轴'}
        </span>
      )}
    </div>
  )
}