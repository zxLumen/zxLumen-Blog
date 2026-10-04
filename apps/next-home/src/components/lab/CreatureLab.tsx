'use client'

/**
 * `/lab/creature` 的主体:描述切换 + 六套渲染器并排 + 群飞。
 *
 * 六张卡**同时**挂在页面上、共用一条时间轴 —— 这样能直接横向对比同一份 DNA 在
 * 不同渲染技术下的性格差异,而不是一张张切换(切换看不出"哪套更贵")。
 */

import { useMemo, useState } from 'react'
import { PRESET_DESCRIPTIONS, fallbackDna, heuristicScore, STAGE_LABELS } from '@zx/shared/creature'
import { Timeline } from './Timeline'
import { SwarmCreature } from './SwarmCreature'
import { SvgCssCreature } from './renderers/SvgCssCreature'
import { SvgGooCreature } from './renderers/SvgGooCreature'
import { FlowFieldCreature } from './renderers/FlowFieldCreature'
import { VerletCreature } from './renderers/VerletCreature'
import { GpuParticleCreature } from './renderers/GpuParticleCreature'
import { MeshCreature } from './renderers/MeshCreature'
import { useLabDay } from './store'
import { formOfDay, stageOfDay, boundsOf } from './renderers/shared'

/** 六套渲染器:名字、组件、一句话性格 */
const RENDERERS = [
  {
    id: 'svg-css',
    title: 'SVG + CSS',
    tone: '机械、可控、极省电',
    note: '几何由 JS 逐帧算,扇动/浮动/辉光交给 CSS 合成器。增长几乎不涨主线程开销。',
    C: SvgCssCreature,
  },
  {
    id: 'svg-goo',
    title: 'SVG 液态滤镜',
    tone: '黏稠、有机',
    note: 'feGaussianBlur + 高对比 ColorMatrix 融成 metaball,再叠湍流位移。滤镜动画只能内联 SVG + SMIL。',
    C: SvgGooCreature,
  },
  {
    id: 'flow',
    title: 'Canvas 流场',
    tone: '飘、不可预测',
    note: '永不清屏的拖尾缓冲 + 旋度流场。粒子各自认领骨架点,所以轮廓还是那只生物。',
    C: FlowFieldCreature,
  },
  {
    id: 'verlet',
    title: 'Canvas 软体',
    tone: '有质量、会下垂',
    note: 'Verlet 质点 + 距离约束投影。躯干弹簧拉向骨架、肢体只轻轻回位,所以会甩会抖。',
    C: VerletCreature,
  },
  {
    id: 'gpu',
    title: 'WebGL2 GPU 粒子',
    tone: '最亮、最多、轮廓靠密度',
    note: '粒子状态常驻 GPU,transform feedback 无回读积分;用 gl_VertexID 拉取骨架锚点。',
    C: GpuParticleCreature,
  },
  {
    id: 'mesh',
    title: 'WebGL 顶点位移网格',
    tone: '唯一有体积的',
    note: '网格顶点位置全在 vertex shader 算,不传顶点属性;CPU 每帧只传一张中轴纹理。',
    C: MeshCreature,
  },
] as const

export function CreatureLab() {
  const [descIdx, setDescIdx] = useState(0)
  const [custom, setCustom] = useState('')
  const day = useLabDay()

  const descr = custom.trim() || PRESET_DESCRIPTIONS[descIdx]
  // 描述不变时 DNA 必须不变 —— useMemo 依赖字符串而非索引
  const dna = useMemo(() => fallbackDna(descr), [descr])
  const form = formOfDay(dna, day)
  const { stage } = stageOfDay(day)
  const score = useMemo(() => heuristicScore(dna, descr), [dna, descr])

  return (
    <div className="cl-root">
      <header className="cl-head">
        <h1>
          Lumen 生灵 · 六渲染技术版<span className="cl-en">Luminari</span>
        </h1>
        <p>
          同一份 DNA、同一段时间轴,六套渲染技术并排跑。目的是挑一条**上生产**的路 ——
          形态全部由 DNA 推导,渲染器不做任何艺术判断。
        </p>
      </header>

      <section className="cl-picker" aria-label="选一只">
        <div className="cl-picker-presets">
          {PRESET_DESCRIPTIONS.map((d, i) => (
            <button
              key={d}
              type="button"
              className={!custom.trim() && i === descIdx ? 'is-on' : ''}
              onClick={() => {
                setDescIdx(i)
                setCustom('')
              }}
            >
              {d.length > 12 ? `${d.slice(0, 12)}…` : d}
            </button>
          ))}
        </div>
        <input
          className="cl-picker-input"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="或者自己写一句描述(程序推导,离线可跑)"
          aria-label="自定义描述"
        />
      </section>

      {/* 当前形态摘要:用来核对「DNA 变了吗」,也顺便暴露解算结果是否合理 */}
      <section className="cl-facts">
        <span className="cl-fact-name">{dna.name}</span>
        <span>{dna.archetype}</span>
        <span data-stage={stage}>{STAGE_LABELS[stage]}</span>
        <span>体节 {form.segments}</span>
        <span>尺寸 {form.size.toFixed(0)}</span>
        <span>辉光 {(form.glow * 100) | 0}%</span>
        <span>拖尾 {(form.trail * 100) | 0}%</span>
        <span>工艺分 {score.total.toFixed(1)}</span>
        <span className="cl-fact-note">{form.note}</span>
      </section>

      <Timeline />

      <div className="cl-grid">
        {RENDERERS.map((r) => {
          const { C } = r
          return (
            <article key={r.id} className="cl-card" data-renderer={r.id}>
              <header>
                <h2>{r.title}</h2>
                <span className="cl-card-tone">{r.tone}</span>
              </header>
              {/* box 随体型缩放:所有原型在同一张卡里都能看清。
                  上限 260 是为了觉醒期也不会把卡片顶高 —— 演示要看的是
                  「比例变化」,不是「占多大地方」。 */}
              <div className="cl-stage">
                <C dna={dna} box={Math.min(260, Math.round(120 + boundsOf(form) * 26))} />
              </div>
              <p>{r.note}</p>
            </article>
          )
        })}

        <article className="cl-card" data-renderer="swarm">
          <header>
            <h2>群飞</h2>
            <span className="cl-card-tone">空间编排</span>
          </header>
          <div className="cl-stage">
            <SwarmCreature box={220} />
          </div>
          <p>复用 SVG 路线跑 5 只:验证独立相位、缩放与互不干扰的漂浮轨迹。5 只共用同一条时间轴。</p>
        </article>
      </div>
    </div>
  )
}