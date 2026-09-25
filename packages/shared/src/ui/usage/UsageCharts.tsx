'use client'

import { useState } from 'react'
import { fmtCompact, fmtInt } from '../../format.js'
import type { UsageRow } from '../../schema.js'
import { modelColor, modelLabel, rowCost } from './constants.js'
import { Donut } from './Donut.js'
import { useBarTooltip } from '../BarTooltip.js'

export function UsageCharts({
  hourMode,
  rangeLabel,
  daySeries,
  altFor,
  maxDaily,
  byModel,
  hasPicked,
}: {
  hourMode: boolean
  rangeLabel: string
  daySeries: Array<[string, number, number]>
  altFor: (dt: string) => boolean
  maxDaily: number
  byModel: Array<{ model: string; input: number; output: number }>
  hasPicked: boolean
}) {
  const [hover, setHover] = useState<string | null>(null)
  const barTip = useBarTooltip()
  const total = Math.max(1, byModel.reduce((a, m) => a + m.input + m.output, 0))
  const activeModel = hover ? byModel.find((m) => m.model === hover) ?? null : null

  return (
    <div className="zx-usage-charts">
      <div className="zx-panel">
        <h3>
          {hourMode ? 'HOURLY_TOKENS' : 'DAILY_TOKENS'}{' '}
          <span>
            {hourMode ? '一天内分时 · UTC+8 · input + output' : `${rangeLabel} · input + output`}
          </span>
        </h3>
        <div className="zx-bars" onMouseMove={barTip.onMouseMove} onMouseLeave={barTip.onMouseLeave}>
          {daySeries.map(([dt, input, output]) => {
            const v = input + output
            const label = hourMode ? `${dt.slice(5, 10)} ${dt.slice(11, 13)}:00` : dt.slice(5)
            return (
              <div
                key={dt}
                className={`zx-bar${v === 0 ? ' is-zero' : altFor(dt) ? ' is-alt' : ''}`}
                data-label={`${label} · ${fmtCompact(v)}`}
                style={{ height: `${Math.max(3, (v / maxDaily) * 100)}%` }}
              />
            )
          })}
        </div>
        {barTip.node}
      </div>

      <div className="zx-panel">
        <h3>
          BY_MODEL <span>{hasPicked ? '所选模型' : 'tokens 占比'}</span>
        </h3>
        <div style={{ display: 'grid', gap: '1rem', placeItems: 'center' }}>
          <Donut data={byModel} hover={hover} onHover={setHover} />
          <div className={`zx-donut-caption${activeModel ? ' is-active' : ''}`}>
            {activeModel ? (
              <>
                <span
                  className="zx-legend-dot"
                  style={{ background: modelColor(activeModel.model), color: modelColor(activeModel.model) }}
                />
                <span>{modelLabel(activeModel.model)}</span>
                <span className="zx-muted">
                  · {fmtCompact(activeModel.input + activeModel.output)} ·{' '}
                  {(((activeModel.input + activeModel.output) / total) * 100).toFixed(1)}%
                </span>
              </>
            ) : (
              <span className="zx-muted">悬停查看模型占比</span>
            )}
          </div>
          <div className="zx-legend" style={{ width: '100%' }}>
            {byModel.map((m) => (
              <div
                className={`zx-legend-item${hover === m.model ? ' is-active' : ''}`}
                key={m.model}
                onMouseEnter={() => setHover(m.model)}
                onMouseLeave={() => setHover(null)}
              >
                <span
                  className="zx-legend-dot"
                  style={{ background: modelColor(m.model), color: modelColor(m.model) }}
                />
                <span style={{ flex: 1 }}>{modelLabel(m.model)}</span>
                <span className="zx-mono">{fmtCompact(m.input + m.output)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function RecentTable({
  hourMode,
  rangeLabel,
  rangeWin,
  recent,
  hasKey,
  keyLabel,
  keyOf,
  showReq,
  rowLabel,
  fmtCost,
}: {
  hourMode: boolean
  rangeLabel: string
  rangeWin: string
  recent: UsageRow[]
  hasKey: boolean
  keyLabel: string
  /** 该列取值(缺省取 apiKey);如 opencode 取服务账号 */
  keyOf?: (r: UsageRow) => string
  showReq: boolean
  rowLabel: (r: UsageRow) => string
  fmtCost: (n: number) => string
}) {
  return (
    <div className="zx-panel">
      <h3>
        RECENT{' '}
        <span>
          {rangeLabel}
          {rangeWin ? ` · ${rangeWin}` : ''} {hourMode ? '分时明细(天/小时/模型)' : '明细(按天/模型)'}
        </span>
      </h3>
      <table className="zx-table">
        <thead>
          <tr>
            <th>{hourMode ? 'day/hour' : 'day'}</th>
            <th>model</th>
            {hasKey && <th>{keyLabel}</th>}
            <th className="num">input</th>
            <th className="num">output</th>
            <th className="num">cache</th>
            {showReq && <th className="num">req</th>}
            <th className="num">成本</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r, i) => (
            <tr key={i}>
              <td className="zx-mono">{rowLabel(r)}</td>
              <td>{modelLabel(r.model)}</td>
              {hasKey && <td className="zx-mono">{(keyOf ? keyOf(r) : r.apiKey || '') || '—'}</td>}
              <td className="num">{fmtInt(r.inputTokens)}</td>
              <td className="num">{fmtInt(r.outputTokens)}</td>
              <td className="num">{fmtInt(r.cacheHitTokens)}</td>
              {showReq && <td className="num">{fmtInt(r.requests ?? 0)}</td>}
              <td className="num">{fmtCost(rowCost(r))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
