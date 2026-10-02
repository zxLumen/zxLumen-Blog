'use client'

/**
 * 物种实验室 —— 「像不像」的试验台。
 *
 * 与 `/lab/creature`(六渲染技术对比)不同,这里只问一件事:**同一份 DNA,
 * 用「物种解剖 rig」能不能画出真像那只动物的东西,并且每天都看得出在长。**
 *
 * 一条成长条带把第 0/2/4/7/10/14/19/30/60 天并排摆出来 —— 「每天都有变化」
 * 这件事必须一眼可验,而不是靠拖时间轴去感受。
 */

import { useMemo, useState } from 'react'
import { fallbackDna, PRESET_DESCRIPTIONS } from '@zx/shared/creature'
import { Timeline } from './Timeline'
import { useLabDay } from './store'
import { SPECIES_LIST, speciesFor } from './species'
import { RigCreature } from './renderers/RigCreature'

/** 成长条带取样点:稀疏在前、密集在中(变化最快的一段),再取满级与平台期 */
const STRIP_DAYS = [0, 2, 4, 7, 10, 14, 19, 25, 34, 45, 60]

/** rig 生长基本定型的参考天数(与 RigCreature 的缩放曲线一致) */
const RIG_MATURE_DAY = 34

export function SpeciesLab() {
  const day = useLabDay()
  const [speciesId, setSpeciesId] = useState<string | 'auto'>('auto')
  const [custom, setCustom] = useState('')
  const [presetIdx, setPresetIdx] = useState(0)

  const descr = custom.trim() || PRESET_DESCRIPTIONS[presetIdx]
  const autoRig = useMemo(() => speciesFor(descr), [descr])
  const rig = speciesId === 'auto' ? autoRig : (SPECIES_LIST.find((r) => r.id === speciesId) ?? autoRig)
  const dna = useMemo(() => fallbackDna(descr), [descr])
  const growthPct = Math.round(Math.min(1, day / RIG_MATURE_DAY) * 100)

  return (
    <div className="cl-root sp-root">
      <header className="cl-head">
        <h1>物种实验室</h1>
        <p>
          同一份 DNA,用**物种解剖 rig**(翅 / 腿 / 尾 / 耳各是独立部件)渲染。
          对照 <a href="/lab/creature">六渲染技术版</a>:那边比的是「技术」,这边比的是「像不像 + 每天长不长」。
        </p>
      </header>

      <section className="cl-picker" aria-label="选物种">
        <button
          type="button"
          className={speciesId === 'auto' ? 'is-on' : ''}
          onClick={() => setSpeciesId('auto')}
        >
          按描述自动
        </button>
        {SPECIES_LIST.map((r) => (
          <button
            key={r.id}
            type="button"
            className={speciesId === r.id ? 'is-on' : ''}
            onClick={() => setSpeciesId(r.id)}
          >
            {r.label}
          </button>
        ))}
      </section>

      <section className="cl-picker" aria-label="选描述">
        <div className="cl-picker-presets">
          {PRESET_DESCRIPTIONS.map((d, i) => (
            <button
              key={d}
              type="button"
              className={!custom.trim() && i === presetIdx ? 'is-on' : ''}
              onClick={() => {
                setPresetIdx(i)
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
          placeholder="或者写一句描述(决定配色与性格;物种可另外手选)"
          aria-label="自定义描述"
        />
      </section>

      <section className="cl-facts">
        <span className="cl-fact-name">{dna.name}</span>
        <span>{rig.label}</span>
        <span data-stage="grow">成长 {growthPct}%</span>
        <span>第 {day.toFixed(1)} 天</span>
        <span className="cl-fact-note">{rig.hint}</span>
      </section>

      <div className="sp-stage">
        <RigCreature dna={dna} rig={rig} box={360} />
      </div>

      <Timeline fullDays={RIG_MATURE_DAY} showStage={false} />

      <section className="sp-strip" aria-label="成长条带">
        <h2>成长条带 · 同一天只看一眼就能比</h2>
        <div className="sp-strip-row">
          {STRIP_DAYS.map((d) => (
            <figure key={d} className="sp-strip-cell">
              <RigCreature dna={dna} rig={rig} box={104} fixedDay={d} />
              <figcaption>D{d}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  )
}
