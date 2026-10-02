'use client'

/**
 * 共享时间轴 —— 六张渲染卡 + 群飞**共用同一个天数**。
 *
 * 之所以做成全局 store 而不是给每张卡各传一个 `day` prop:播放时天数每帧都在变,
 * 走 props 就等于每帧让 React 调和整棵卡片树(六套渲染器各带自己的 canvas/SVG)。
 * 现在只有这一条控制栏订阅天数,渲染器在自己的 rAF 里直接读值。
 */

import { useEffect } from 'react'
import { dayStore, useLabDay, useLabFlags, MAX_DAY, SPEEDS, type Speed } from './store'
import { FULL_DAYS, stageOfDay } from './renderers/shared'
import { STAGE_LABELS } from '@zx/shared/creature'

/** 预设跳转点:阶段边界附近 + 若干里程碑 */
const MARKS = [0, 1, 2, 3, 5, 7, 14, 21, 30, 45, 60]

export interface TimelineProps {
  /** 「满级」参考天数。默认沿用旧经验系统的 FULL_DAYS;物种页传自己的成熟天数 */
  fullDays?: number
  /** 是否显示旧的「孢子/幼体/成体/觉醒」阶段徽章(物种 rig 不按这套分阶段) */
  showStage?: boolean
}

export function Timeline({ fullDays, showStage = true }: TimelineProps = {}) {
  const day = useLabDay()
  const { playing, speed, loop } = useLabFlags()
  const { stage, progress } = stageOfDay(day)
  const full = Math.ceil(fullDays ?? FULL_DAYS)

  // 首次进来自动开播:这是个演示,进来就该看见它在长,而不是一张静止的 Day 0。
  useEffect(() => {
    dayStore.autoplayOnce()
  }, [])

  const jump = (d: number) => {
    dayStore.pause()
    dayStore.setDay(d)
  }

  return (
    <section className="cl-timeline" aria-label="成长时间轴">
      <div className="cl-tl-head">
        <div className="cl-tl-state">
          <span className="cl-tl-day">
            第 <b>{day.toFixed(day < 10 ? 1 : 0)}</b> 天
          </span>
          {showStage && (
            <span className="cl-tl-stage" data-stage={stage}>
              <i className="cl-tl-prog" style={{ transform: `scaleX(${progress.toFixed(3)})` }} />
              <span>{STAGE_LABELS[stage]}</span>
            </span>
          )}
          <span className="cl-tl-note">满级约 {full} 天</span>
        </div>

        <div className="cl-tl-ctl">
          <button type="button" onClick={() => jump(0)} title="回到第 0 天" aria-label="重置">
            ⟲
          </button>
          <button
            type="button"
            className="cl-tl-play"
            onClick={() => dayStore.toggle()}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button type="button" onClick={() => jump(day + 1)} title="前进一天" aria-label="单步前进">
            ⏭
          </button>
          <div className="cl-tl-speed" role="group" aria-label="播放速度">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={s === speed ? 'is-on' : ''}
                onClick={() => dayStore.setSpeed(s as Speed)}
              >
                {s}×
              </button>
            ))}
          </div>
          <label className="cl-tl-loop">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => dayStore.setLoop(e.target.checked)}
            />
            循环
          </label>
        </div>
      </div>

      {/* 滑块:唯一能精确落在任意一天的控件,拖动时会暂停 */}
      <input
        className="cl-tl-range"
        type="range"
        min={0}
        max={MAX_DAY}
        step={0.1}
        value={day}
        onChange={(e) => jump(Number(e.target.value))}
        aria-label="天数"
      />

      <div className="cl-tl-marks">
        {MARKS.map((d) => (
          <button
            key={d}
            type="button"
            className={Math.abs(day - d) < 0.5 ? 'is-on' : ''}
            onClick={() => jump(d)}
            title={`第 ${d} 天`}
          >
            D{d}
          </button>
        ))}
      </div>
    </section>
  )
}