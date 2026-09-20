'use client'

import { useMemo, useState } from 'react'
import { dailyAggregate, genMockUsage, modelAggregate } from '../mock.js'
import { PRICING, estimateCost, tokensOf } from '../pricing.js'
import type { UsageRow } from '../schema.js'
import { fmtCompact, fmtCny, fmtDate, fmtInt } from '../format.js'
import { Section } from './Section.js'

const modelColor = (model: string) => PRICING.find((p) => p.model === model)?.color ?? 'var(--accent)'
const modelLabel = (model: string) => PRICING.find((p) => p.model === model)?.label ?? model

export function UsageSection({ rows }: { rows?: UsageRow[] }) {
  const usingMock = !rows || rows.length === 0
  const allData = useMemo(() => (rows && rows.length > 0 ? rows : genMockUsage(30)), [rows])

  const models = useMemo(
    () => Array.from(new Set(allData.map((r) => r.model))),
    [allData],
  )

  // 选中的模型(空 = 整体)
  const [picked, setPicked] = useState<string[]>([])
  const active = useMemo(
    () => (picked.length > 0 ? allData.filter((r) => picked.includes(r.model)) : allData),
    [allData, picked],
  )

  const totals = tokensOf(active)
  const totalCost = active.reduce((a, r) => a + estimateCost(r).total, 0)
  const daily = dailyAggregate(active)
  const byModel = modelAggregate(active)
  const maxDaily = Math.max(1, ...daily.map((d) => d[1] + d[2]))
  const modelTotal = Math.max(1, byModel.reduce((a, m) => a + m.input + m.output, 0))

  let acc = 0
  const slices = byModel.map((m) => {
    const pct = ((m.input + m.output) / modelTotal) * 360
    const start = acc
    acc += pct
    return { ...m, start, end: acc }
  })

  const donutBg = slices.length
    ? `conic-gradient(${slices
        .map((s) => `${modelColor(s.model)} ${s.start}deg ${s.end}deg`)
        .join(', ')})`
    : undefined

  const recent = [...active].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 8)

  function toggle(model: string) {
    setPicked((prev) =>
      prev.includes(model) ? prev.filter((x) => x !== model) : [...prev, model],
    )
  }

  return (
    <Section id="usage" tag="// TOKEN USAGE" num="02" title="DeepSeek 用量">
      <div className="zx-seg" role="group" aria-label="用量筛选">
        <button
          type="button"
          className={`zx-chip${picked.length === 0 ? ' is-active' : ''}`}
          onClick={() => setPicked([])}
        >
          整体用量
        </button>
        {models.map((m) => (
          <button
            key={m}
            type="button"
            className={`zx-chip${picked.includes(m) ? ' is-active' : ''}`}
            onClick={() => toggle(m)}
          >
            <span className="zx-legend-dot" style={{ background: modelColor(m), color: modelColor(m) }} />
            {modelLabel(m)}
          </button>
        ))}
      </div>

      <div className="zx-grid-stats">
        <div className="zx-stat">
          <div className="zx-stat-now">{fmtCompact(totals.total)}</div>
          <div className="zx-stat-label">总 tokens</div>
        </div>
        <div className="zx-stat">
          <div className="zx-stat-now">{fmtCompact(totals.input)}</div>
          <div className="zx-stat-label">输入</div>
        </div>
        <div className="zx-stat">
          <div className="zx-stat-now">{fmtCompact(totals.output)}</div>
          <div className="zx-stat-label">输出</div>
        </div>
        <div className="zx-stat">
          <div className="zx-stat-now">{fmtCompact(totals.cacheHit)}</div>
          <div className="zx-stat-label">缓存命中</div>
        </div>
        <div className="zx-stat">
          <div className="zx-stat-now">{fmtCny(totalCost)}</div>
          <div className="zx-stat-label">预估成本 · 30d</div>
        </div>
      </div>

      <div className="zx-usage-charts">
        <div className="zx-panel">
          <h3>
            DAILY_TOKENS <span>近 30 天 · input + output</span>
          </h3>
          <div className="zx-bars">
            {daily.map(([day, input, output]) => {
              const v = input + output
              return (
                <div
                  key={day}
                  className="zx-bar"
                  data-label={`${day.slice(5)} · ${fmtCompact(v)}`}
                  style={{ height: `${Math.max(3, (v / maxDaily) * 100)}%` }}
                />
              )
            })}
          </div>
        </div>

        <div className="zx-panel">
          <h3>
            BY_MODEL <span>{picked.length > 0 ? '所选模型' : 'tokens 占比'}</span>
          </h3>
          <div style={{ display: 'grid', gap: '1rem', placeItems: 'center' }}>
            <div className="zx-donut" style={{ background: donutBg }} />
            <div className="zx-legend" style={{ width: '100%' }}>
              {byModel.map((m) => (
                <div className="zx-legend-item" key={m.model}>
                  <span className="zx-legend-dot" style={{ background: modelColor(m.model), color: modelColor(m.model) }} />
                  <span style={{ flex: 1 }}>{modelLabel(m.model)}</span>
                  <span className="zx-mono">{fmtCompact(m.input + m.output)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="zx-panel">
        <h3>
          RECENT <span>最近调用</span>
        </h3>
        <table className="zx-table">
          <thead>
            <tr>
              <th>time</th>
              <th>model</th>
              <th className="num">input</th>
              <th className="num">output</th>
              <th className="num">cache</th>
              <th className="num">成本</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r, i) => (
              <tr key={i}>
                <td className="zx-mono">{fmtDate(r.ts)}</td>
                <td>{modelLabel(r.model)}</td>
                <td className="num">{fmtInt(r.inputTokens)}</td>
                <td className="num">{fmtInt(r.outputTokens)}</td>
                <td className="num">{fmtInt(r.cacheHitTokens)}</td>
                <td className="num">{fmtCny(estimateCost(r).total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', marginTop: '0.8rem' }}>
        {usingMock
          ? '// 当前为 demo 数据;你的 DeepSeek 服务调用 POST /api/usage 后将自动显示真实用量'
          : '// 实时数据 · 来自 DeepSeek 服务上报'}
      </p>
    </Section>
  )
}
