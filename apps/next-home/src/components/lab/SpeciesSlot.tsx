'use client'

/**
 * 一个物种槽位 —— **格子之间完全独立**。
 *
 * 之前整个页面只有一份 `compiled`,六个预设按钮共用它,于是:
 *   - 一个在生成,其余五个就都被锁住;
 *   - 点 B 会把 A 的产物顶掉(切过去看到的是同一只);
 *   - A 的产物被丢弃时上游还在烧钱。
 *
 * 现在**一格一个 `useCreatureGen()` 实例**:各自的产物 / loading / 错误 / 历史。
 * 在这一格没生成过之前,它展示的是「默认产物」(`speciesFor` + `fallbackDna`),
 * 绝不会显示别格的产物。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fallbackDna, type CreatureDna } from '@zx/shared/creature'
import { RigCreature } from './renderers/RigCreature'
import { speciesFor, type Rig } from './species'
import { useCreatureGen, type GenRecord } from './blueprint/useCreatureGen'

/** 分项中文名(展示用) */
const SCORE_LABELS: Record<string, string> = {
  palette: '配色',
  traits: '特质',
  motion: '动效',
  narrative: '叙事',
  match: '契合',
}
const SCORE_KEYS = ['palette', 'traits', 'motion', 'narrative', 'match'] as const

/** 手写物种的定型天数;生成物种用 blueprint 自己的 matureDay */
const RIG_MATURE_DAY = 34

/** 成长条带取样点:稀疏在前、密集在中(变化最快的一段),再取满级与平台期 */
const STRIP_DAYS = [0, 2, 4, 7, 10, 14, 19, 25, 34, 45, 60]

/** 秒 → 「1分20s」这种读起来更像人话的写法 */
function humanSec(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}s`
}

export interface SpeciesSlotProps {
  /** 稳定 key:父组件用同一个 key 保住这一格的状态(历史 / 输入框内容) */
  slotKey: string
  /** 格子标题 */
  label: string
  /** 预设描述(固定);`editable` 时可省略,改用格子里的输入框 */
  descr?: string
  /** 格子自带输入框(只有「自己写」那一格是) */
  editable?: boolean
  /** 是否在页面上选中(选中态只加个描边,不替换产物) */
  active?: boolean
  /** 点格子主体:选中它(成长条带跟着它走) */
  onSelect?: (slotKey: string) => void
  /** 生成成功:上报给页面汇总「本次生成过什么」 */
  onRecord?: (r: GenRecord) => void
  /** 外部触发(如「全部生成」):自增计数,每个槽位各认一次 */
  trigger?: number
}

export function SpeciesSlot({
  slotKey,
  label,
  descr = '',
  editable = false,
  active = false,
  onSelect,
  onRecord,
  trigger = 0,
}: SpeciesSlotProps) {
  /** 只有「自己写」那格有输入框;预设格的文字是固定的 */
  const [text, setText] = useState(descr)
  const target = (editable ? text.trim() : descr).trim()

  const handleRecord = useCallback(
    (r: GenRecord) => {
      onRecord?.(r)
      onSelect?.(slotKey) // 谁先出结果谁上「选中」,成长条带跟过去
    },
    [onRecord, onSelect, slotKey],
  )
  const { compiled, state, history, generate, wait } = useCreatureGen({ onRecord: handleRecord })

  /** 没生成过(或生成彻底失败)时展示的默认产物 —— 绝不用别格的 */
  const fallback = useMemo(() => {
    const rig: Rig = speciesFor(target)
    return { rig, dna: fallbackDna(target), matureDay: RIG_MATURE_DAY }
  }, [target])

  /** 只有「确实生成了骨架」才用它;临时错误(限流)保留上一次成功的生物 */
  const usingGenerated = compiled !== null && !state.fallback
  const dna: CreatureDna = usingGenerated ? compiled.dna : fallback.dna
  const rig = usingGenerated ? compiled.rig : fallback.rig
  const matureDay = usingGenerated ? compiled.matureDay : fallback.matureDay
  const score = state.score

  /** 外部触发(如「全部生成」):只在计数真的前进时跑一次 */
  const seenTrigger = useRef(0)
  useEffect(() => {
    if (trigger <= 0 || trigger === seenTrigger.current) return
    seenTrigger.current = trigger
    if (target && !state.loading) void generate(target)
  }, [trigger, target, state.loading, generate])

  const last = history[0]
  const verdict = score ? (score.total >= 75 ? 'ok' : score.total >= 55 ? 'mid' : 'bad') : undefined
  const queued = state.loading && state.queuePosition > 0

  return (
    <article
      className="sp-slot"
      data-active={active ? '1' : '0'}
      data-status={state.loading ? 'loading' : state.error ? 'error' : usingGenerated ? 'done' : 'idle'}
    >
      <header className="sp-slot-head">
        <button
          type="button"
          className="sp-slot-go"
          title={target || '写点什么再生成'}
          disabled={state.loading || !target}
          onClick={() => void generate(target)}
        >
          {state.loading ? '生成中…' : label}
        </button>
        <span className="sp-slot-name">{dna.name}</span>
      </header>

      <div
        className="sp-slot-stage"
        onClick={() => onSelect?.(slotKey)}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect?.(slotKey)
        }}
      >
        <RigCreature dna={dna} rig={rig} box={190} matureDay={matureDay} />
        {!usingGenerated && !state.loading && <span className="sp-slot-mask">未生成 · 默认产物</span>}
      </div>

      {editable && (
        <input
          className="cl-picker-input sp-slot-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="描述你想养的生物…"
          aria-label="描述"
        />
      )}

      {/* 生成中:阶段 + 已等 + 预计 + 进度条。排队文案是服务端真话,优先显示 */}
      {state.loading && wait && (
        <div className="sp-slot-wait" data-queue={queued ? '1' : '0'}>
          <div className="sp-slot-phase">
            {queued ? (
              <>
                <b>⏳ 排队</b> 前面还有 {state.queuePosition} 只 · 约 {Math.round(state.queueEtaMs / 1000)}s
              </>
            ) : (
              <>
                <b>
                  第 {wait.stage + 1}/{wait.stages} 步
                </b>
                {wait.text}
              </>
            )}
          </div>
          <div className="sp-slot-time">
            已等 <b>{humanSec(wait.waitedMs)}</b>
            <span className="sp-slot-eta" data-over={wait.overdue ? '1' : '0'}>
              {queued
                ? ' · 还没开始'
                : wait.overdue
                  ? ` · 比平时慢(平时约 ${humanSec(wait.estimateMs)})`
                  : ` · 预计还要 ${humanSec(wait.etaMs)}`}
            </span>
          </div>
          <div className="sp-slot-bar">
            <i style={{ width: `${Math.round(wait.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {/* 临时错误(限流等)保留上一只产物,所以只提示、不换舞台 */}
      {!state.loading && state.error && (
        <p className="sp-slot-err" data-bad={state.fallback ? '1' : '0'}>
          ⚠ {state.error}
        </p>
      )}

      {usingGenerated && last && (
        <footer className="sp-slot-foot">
          <div className="sp-slot-meta">
            <span className="sp-chip" data-score={verdict} title="本地启发式评分,满分 100">
              {score?.total.toFixed(0) ?? '—'}
            </span>
            <span>{last.parts} 件</span>
            <span>{matureDay} 天</span>
            <span className="sp-slot-ms">{(last.ms / 1000).toFixed(1)}s</span>
          </div>
          <div
            className="sp-slot-dims"
            title={SCORE_KEYS.map((k) => `${SCORE_LABELS[k]} ${Math.round(score!.dims[k] * 100)}`).join(' / ')}
          >
            {SCORE_KEYS.map((k) => (
              <span key={k} className="sp-slot-dim">
                <i>
                  <b style={{ width: `${Math.round((score?.dims[k] ?? 0) * 100)}%` }} />
                </i>
              </span>
            ))}
          </div>
        </footer>
      )}

      {/* 成长条带只展开在选中的那一格 —— 各格产物独立,但共用上面那条时间轴 */}
      {active && (
        <div className="sp-slot-strip" title={`${dna.name} · D0…D60`}>
          {STRIP_DAYS.map((d) => (
            <figure key={d} className="sp-slot-strip-cell">
              <RigCreature dna={dna} rig={rig} box={92} fixedDay={d} matureDay={matureDay} />
              <figcaption>D{d}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </article>
  )
}