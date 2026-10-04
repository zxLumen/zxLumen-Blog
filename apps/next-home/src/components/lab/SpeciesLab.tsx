'use client'

/**
 * 物种实验室 —— 「像不像 + 独特性」的试验台。
 *
 * 主路径是 **LLM 现场生成骨架**:输入描述 → 模型产出部件树 + DNA → 编译成 rig → 渲染。
 * 每只生物用**本地启发式**打分(配色/特质/运动/叙事/描述契合),零额外调用。
 *
 * **一格一个槽位,格子之间互不干扰。** 六个预设 + 一个「自己写」,各跑各的:
 * 谁也不等谁、谁也不顶掉谁 —— 在某一格生成完之前,那一格展示的是**默认产物**
 * (`speciesFor` + `fallbackDna`),绝不会显示别格的产物。成长时间轴是共享的,
 * 点哪一格就展开哪一格的成长条带。
 *
 * 手写的 `butterfly` / `fox` **保留为兜底**:模型彻底失败时至少展示一只像样的生物。
 */

import { useCallback, useState } from 'react'
import { PRESET_DESCRIPTIONS } from '@zx/shared/creature'
import { Timeline } from './Timeline'
import { SpeciesSlot } from './SpeciesSlot'
import type { GenRecord } from './blueprint/useCreatureGen'

export function SpeciesLab() {
  /** 各格上报的记录合并成「本次会话生成过什么」 */
  const [all, setAll] = useState<GenRecord[]>([])
  /** 选中格:只影响成长条带展开在哪,不影响任何产物 */
  const [activeKey, setActiveKey] = useState<string | null>(null)
  /** 「全部生成」的触发计数:自增,每个槽位各认一次 */
  const [trigger, setTrigger] = useState(0)

  const onRecord = useCallback((r: GenRecord) => setAll((prev) => [r, ...prev].slice(0, 24)), [])

  return (
    <div className="cl-root sp-root">
      <header className="cl-head">
        <h1>物种实验室</h1>
        <p>
          描述任意生物,由**大模型现场生成骨架与 DNA**(部件树 + 配色 + 运动),再渲染并用本地启发式打分。
          **每格互不干扰** —— 六个预设 + 一个「自己写」可以同时在跑。对照{' '}
          <a href="/lab/creature">六渲染技术版</a>;想看<b>分数可不可信</b>去{' '}
          <a href="/lab/score">打分校验台</a>。
        </p>
        <div className="sp-bulk">
          <button type="button" className="sp-go" onClick={() => setTrigger((n) => n + 1)}>
            全部生成(7 只)
          </button>
          <span className="sp-bulk-note">并发起 7 次,各占服务端一个并发槽位</span>
        </div>
      </header>

      <section className="sp-slots" aria-label="物种槽位">
        {PRESET_DESCRIPTIONS.map((d, i) => (
          <SpeciesSlot
            key={`p${i}`}
            slotKey={`p${i}`}
            label={d.length > 12 ? `${d.slice(0, 12)}…` : d}
            descr={d}
            active={activeKey === `p${i}`}
            onSelect={setActiveKey}
            onRecord={onRecord}
            trigger={trigger}
          />
        ))}
        <SpeciesSlot
          key="custom"
          slotKey="custom"
          label="自己写"
          editable
          active={activeKey === 'custom'}
          onSelect={setActiveKey}
          onRecord={onRecord}
          trigger={trigger}
        />
      </section>

      <Timeline fullDays={60} showStage={false} />

      {/* 本次会话所有槽位生成过什么:一眼看出「同一句话每次都不一样」+ 各自得分 */}
      {all.length > 0 && (
        <section className="sp-history" aria-label="本次生成记录">
          <h2>本次生成 · {all.length} 只</h2>
          <div className="sp-history-row">
            {all.map((h, i) => {
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
    </div>
  )
}