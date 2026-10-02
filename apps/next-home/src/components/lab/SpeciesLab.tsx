'use client'

/**
 * 物种实验室 —— 「像不像」的试验台。
 *
 * 现在的主路径是 **LLM 现场生成骨架**:输入描述 → 模型产出部件树 + DNA → 编译成 rig →
 * 渲染 → 视觉自检(低分自动重捏一次)。
 *
 * 手写的 `butterfly` / `fox` **保留为兜底**:模型不可用 / 超时 / 返回非法 JSON 时,
 * 至少还能展示一只像样的生物,而不是空白。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fallbackDna, PRESET_DESCRIPTIONS, type CreatureDna } from '@zx/shared/creature'
import { Timeline } from './Timeline'
import { useLabDay } from './store'
import { speciesFor } from './species'
import { RigCreature } from './renderers/RigCreature'
import { useCreatureGen } from './blueprint/useCreatureGen'

/** 成长条带取样点:稀疏在前、密集在中(变化最快的一段),再取满级与平台期 */
const STRIP_DAYS = [0, 2, 4, 7, 10, 14, 19, 25, 34, 45, 60]

/** 手写物种的定型天数;生成物种用 blueprint 自己的 matureDay */
const RIG_MATURE_DAY = 34

export function SpeciesLab() {
  const day = useLabDay()
  const [input, setInput] = useState<string>(PRESET_DESCRIPTIONS[0])
  const [committed, setCommitted] = useState<string>(PRESET_DESCRIPTIONS[0])
  const [auto, setAuto] = useState(true)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const { compiled, state, generateWithCheck } = useCreatureGen()

  /** 兜底:模型没给出可用骨架时用手写物种 + fallbackDna */
  const fallback = useMemo(() => {
    const rig = speciesFor(committed)
    return { rig, dna: fallbackDna(committed), matureDay: RIG_MATURE_DAY }
  }, [committed])

  const usingGenerated = compiled !== null && !state.fallback
  const dna: CreatureDna = usingGenerated ? compiled.dna : fallback.dna
  const rig = usingGenerated ? compiled.rig : fallback.rig
  const matureDay = usingGenerated ? compiled.matureDay : fallback.matureDay
  const growthPct = Math.round(Math.min(1, day / matureDay) * 100)

  const run = useCallback(
    (descr: string) => {
      const d = descr.trim()
      if (!d) return
      setCommitted(d)
      void generateWithCheck(d, () => stageRef.current?.querySelector('svg') ?? null)
    },
    [generateWithCheck],
  )

  /**
   * 自动模式:每次 `committed` 变化生成一次。
   *
   * 依赖里**不放 `generateWithCheck`** —— 它每次渲染都是新引用,会导致「描述没变也重生成」,
   * 之前就是这样把接口调了三次。用 ref 拿最新函数,语义才等于「描述变了才生成」。
   */
  const genRef = useRef(generateWithCheck)
  useEffect(() => {
    genRef.current = generateWithCheck
  }, [generateWithCheck])

  const autoRanFor = useRef<string | null>(null)
  useEffect(() => {
    if (!auto) return
    if (autoRanFor.current === committed) return
    autoRanFor.current = committed
    void genRef.current(committed, () => stageRef.current?.querySelector('svg') ?? null)
  }, [committed, auto])

  const judge = state.judge

  return (
    <div className="cl-root sp-root">
      <header className="cl-head">
        <h1>物种实验室</h1>
        <p>
          描述任意生物,由**大模型现场生成骨架与 DNA**(部件树 + 配色 + 运动),
          再渲染 + 视觉自检。对照 <a href="/lab/creature">六渲染技术版</a>。
        </p>
      </header>

      <section className="cl-picker" aria-label="描述">
        <div className="cl-picker-presets">
          {PRESET_DESCRIPTIONS.map((d) => (
            <button key={d} type="button" className={d === committed ? 'is-on' : ''} onClick={() => run(d)}>
              {d.length > 12 ? `${d.slice(0, 12)}…` : d}
            </button>
          ))}
        </div>
        <div className="sp-input-row">
          <input
            className="cl-picker-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run(input)
            }}
            placeholder="描述你想养的生物,比如:一只发光的深海水母"
            aria-label="描述"
          />
          <button type="button" className="sp-go" onClick={() => run(input)} disabled={state.loading}>
            {state.loading ? '生成中…' : '生成'}
          </button>
          <label className="sp-auto">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            自动
          </label>
        </div>
      </section>

      <section className="cl-facts">
        <span className="cl-fact-name">{dna.name}</span>
        <span>{usingGenerated ? '模型生成' : '兜底物种'}</span>
        <span data-stage="grow">成长 {growthPct}%</span>
        <span>第 {day.toFixed(1)} 天</span>
        {state.cached && <span className="sp-chip">缓存</span>}
        {state.ms > 0 && <span className="sp-chip">{state.ms}ms</span>}
        {state.attempts > 1 && <span className="sp-chip">重试 ×{state.attempts}</span>}
        {judge && (
          <span className="sp-chip" data-score={judge.score >= 6 ? 'ok' : 'bad'}>
            自检 {judge.score}/10{judge.looksLike ? ` · 像${judge.looksLike}` : ''}
          </span>
        )}
        <span className="cl-fact-note">{rig.hint}</span>
      </section>

      {(state.loading || state.error || judge) && (
        <div className="sp-status" data-bad={state.error ? '1' : '0'}>
          {state.loading && <span>⏳ {state.phase || '处理中…'}</span>}
          {!state.loading && state.error && <span>⚠ {state.error}(已用兜底物种)</span>}
          {!state.loading && !state.error && judge && judge.score < 6 && judge.issues.length > 0 && (
            <span>模型自评:{judge.issues.join(' / ')}</span>
          )}
        </div>
      )}

      <div className="sp-stage" ref={stageRef}>
        <RigCreature dna={dna} rig={rig} box={360} matureDay={matureDay} />
      </div>

      <Timeline fullDays={matureDay} showStage={false} />

      <section className="sp-strip" aria-label="成长条带">
        <h2>成长条带 · 同一天只看一眼就能比</h2>
        <div className="sp-strip-row">
          {STRIP_DAYS.map((d) => (
            <figure key={d} className="sp-strip-cell">
              <RigCreature dna={dna} rig={rig} box={104} fixedDay={d} matureDay={matureDay} />
              <figcaption>D{d}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  )
}
