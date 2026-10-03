'use client'

/**
 * 物种实验室 —— 「像不像 + 独特性」的试验台。
 *
 * 主路径是 **LLM 现场生成骨架**:输入描述 → 模型产出部件树 + DNA → 编译成 rig → 渲染。
 * 每只生物用**本地启发式**打分(配色/特质/运动/叙事/描述契合),零额外调用;
 * 每次生成都记入本会话历史,并排看「同一句描述每次都不一样」。
 *
 * 手写的 `butterfly` / `fox` **保留为兜底**:模型彻底失败时至少展示一只像样的生物。
 */

import { useCallback, useMemo, useRef, useState } from 'react'
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

/** 分项中文名(展示用) */
const SCORE_LABELS: Record<string, string> = {
  palette: '配色',
  traits: '特质',
  motion: '动效',
  narrative: '叙事',
  match: '契合',
}

export function SpeciesLab() {
  const day = useLabDay()
  /** 输入框内容:预设按钮只是往这里填字,不会触发任何生成 */
  const [input, setInput] = useState<string>(PRESET_DESCRIPTIONS[0])
  /** 当前选中的预设(仅用于高亮) */
  const [selected, setSelected] = useState<string | null>(PRESET_DESCRIPTIONS[0])
  /** **最后一次点「生成」提交的描述**:驱动兜底物种与事实栏。与 input 解耦 */
  const [committed, setCommitted] = useState<string>('')
  const stageRef = useRef<HTMLDivElement | null>(null)

  const { compiled, state, history, generate } = useCreatureGen()

  /** 兜底:模型没给出可用骨架时用手写物种 + fallbackDna */
  const fallback = useMemo(() => {
    const rig = speciesFor(committed)
    return { rig, dna: fallbackDna(committed), matureDay: RIG_MATURE_DAY }
  }, [committed])

  /** 只有「确实生成了骨架」才用它;临时错误(限流)保留上一次成功的生物 */
  const usingGenerated = compiled !== null && !state.fallback
  const dna: CreatureDna = usingGenerated ? compiled.dna : fallback.dna
  const rig = usingGenerated ? compiled.rig : fallback.rig
  const matureDay = usingGenerated ? compiled.matureDay : fallback.matureDay
  const growthPct = Math.round(Math.min(1, day / matureDay) * 100)

  /**
   * **只有「生成」按钮 / 回车才生成。**
   *
   * 之前预设按钮直接 `run(d)`,加上 auto 默认开着,点一下会打两次模型;而连点几次时
   * 前几次的结果被 `abort` 丢掉、**上游却照跑到底照扣额度** —— 实测 35 次请求只有 13
   * 次拿到结果,其余 11 次的算力白烧。现在:
   *   - 预设按钮 =纯文本快捷方式,只填输入框;
   *   - 生成中禁用按钮,一次点击必有一次结果,不存在「白点」;
   *   - 生成期间随便切预设/改输入框,**在途任务完全不受影响**。
   */
  const submit = useCallback(() => {
    const d = input.trim()
    if (!d || state.loading) return
    setCommitted(d)
    void generate(d)
  }, [input, state.loading, generate])

  const score = state.score
  const verdict = score ? (score.total >= 75 ? 'ok' : score.total >= 55 ? 'mid' : 'bad') : undefined

  return (
    <div className="cl-root sp-root">
      <header className="cl-head">
        <h1>物种实验室</h1>
        <p>
          描述任意生物,由**大模型现场生成骨架与 DNA**(部件树 + 配色 + 运动),再渲染并用本地启发式打分。
          对照 <a href="/lab/creature">六渲染技术版</a>。
        </p>
      </header>

      <section className="cl-picker" aria-label="描述">
        <div className="cl-picker-presets">
          {PRESET_DESCRIPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              className={d === selected ? 'is-on' : ''}
              onClick={() => {
                setInput(d)
                setSelected(d)
              }}
            >
              {d.length > 12 ? `${d.slice(0, 12)}…` : d}
            </button>
          ))}
        </div>
        <div className="sp-input-row">
          <input
            className="cl-picker-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setSelected(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="描述你想养的生物,比如:一只发光的深海水母"
            aria-label="描述"
          />
          <button type="button" className="sp-go" onClick={submit} disabled={state.loading || !input.trim()}>
            {state.loading ? '生成中…' : '生成'}
          </button>
        </div>
      </section>

      <section className="cl-facts">
        <span className="cl-fact-name">{dna.name}</span>
        <span>{usingGenerated ? '模型生成' : '兜底物种'}</span>
        {committed && (
          <span
            className="sp-chip"
            title="这条生物对应哪次提交 —— 生成期间你可以随便切预设、改输入框,不影响它"
          >
            本次生成:{committed.length > 14 ? `${committed.slice(0, 14)}…` : committed}
          </span>
        )}
        <span data-stage="grow">成长 {growthPct}%</span>
        <span>第 {day.toFixed(1)} 天</span>
        {state.cached && <span className="sp-chip">缓存</span>}
        {state.ms > 0 && <span className="sp-chip">{(state.ms / 1000).toFixed(1)}s</span>}
        {state.remainingToday >= 0 && (
          <span className="sp-chip" title="每人每天的生成只数;日预算烧完后也会停">
            今日还可 {state.remainingToday} 只
          </span>
        )}
        {score && (
          <span className="sp-chip" data-score={verdict} title="本地启发式评分,满分 100">
            评分 {score.total.toFixed(0)}
          </span>
        )}
        <span className="cl-fact-note">{rig.hint}</span>
      </section>

      {/* 评分明细 + 生成状态 */}
      {(!committed || score || state.loading || state.error) && (
        <div className="sp-status" data-bad={state.error ? '1' : '0'}>
          {!committed && !state.loading && (
            <span>还没生成 —— 上面点个预设或写句话,再点「生成」让模型现场造一只</span>
          )}
          {state.loading && (
            <span data-queue={state.queuePosition > 0 ? '1' : '0'}>
              {state.queuePosition > 0 ? '⏳ 排队' : '⏳'} {state.phase || '处理中…'}
            </span>
          )}
          {!state.loading && state.error && (
            <span>
              ⚠ {state.error}
              {state.fallback ? '(已用兜底物种)' : '(保留上一只)'}
            </span>
          )}
          {!state.loading && score && (
            <span className="sp-breakdown">
              {(['palette', 'traits', 'motion', 'narrative', 'match'] as const).map((k) => (
                <span key={k} className="sp-meter">
                  <em>{SCORE_LABELS[k]}</em>
                  <i>
                    <b style={{ width: `${Math.round(score[k] * 100)}%` }} />
                  </i>
                  <u>{Math.round(score[k] * 100)}</u>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="sp-stage" ref={stageRef}>
        <RigCreature dna={dna} rig={rig} box={360} matureDay={matureDay} />
      </div>

      <Timeline fullDays={matureDay} showStage={false} />

      {/* 本会话生成历史:一眼看出「同一句描述每次都不一样」+ 各自得分 */}
      {history.length > 0 && (
        <section className="sp-history" aria-label="本次生成记录">
          <h2>本次生成 · {history.length} 只</h2>
          <div className="sp-history-row">
            {history.map((h, i) => {
              const v = h.score.total >= 75 ? 'ok' : h.score.total >= 55 ? 'mid' : 'bad'
              return (
                <div key={`${h.at}-${i}`} className="sp-history-cell">
                  <span className="sp-history-name">{h.name}</span>
                  <span className="sp-history-score" data-score={v}>
                    {h.score.total.toFixed(0)}
                  </span>
                  <span className="sp-history-meta">
                    {h.family} · {h.parts}件 · {h.matureDay}天
                  </span>
                  <span className="sp-history-descr">{h.descr}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

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
