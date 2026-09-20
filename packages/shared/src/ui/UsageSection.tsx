'use client'

import { useEffect, useMemo, useState } from 'react'
import { dailyAggregate, genMockUsage, modelAggregate } from '../mock.js'
import { PRICING, estimateCost, tokensOf } from '../pricing.js'
import type { UsageRow } from '../schema.js'
import { fmtCompact, fmtCny, fmtDate, fmtInt } from '../format.js'
import { Section } from './Section.js'

const modelColor = (model: string) => PRICING.find((p) => p.model === model)?.color ?? 'var(--accent)'
const modelLabel = (model: string) => PRICING.find((p) => p.model === model)?.label ?? model
const rowCost = (r: UsageRow) => (typeof r.cost === 'number' ? r.cost : estimateCost(r).total)

type Range = '24h' | '7d' | '30d' | '90d'
const RANGES: Range[] = ['24h', '7d', '30d', '90d']

export function UsageSection({ rows }: { rows?: UsageRow[] }) {
  const [range, setRange] = useState<Range>('30d')
  const [live, setLive] = useState<UsageRow[] | null>(null)
  const [source, setSource] = useState<'server' | 'deepseek' | 'none' | 'invalid' | 'error'>('server')

  useEffect(() => {
    let alive = true
    fetch(`/api/usage?range=${range}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { source?: string; rows?: UsageRow[] }) => {
        if (!alive) return
        if (d.source === 'deepseek' && d.rows) {
          setLive(d.rows)
          setSource('deepseek')
        } else {
          setLive(null)
          setSource((d.source as typeof source) ?? 'none')
        }
      })
      .catch(() => {
        if (alive) {
          setLive(null)
          setSource('error')
        }
      })
    return () => {
      alive = false
    }
  }, [range])

  const liveRows = live && live.length > 0 ? live : null
  const usingMock = !liveRows && !(rows && rows.length)
  const allData = useMemo(
    () => liveRows ?? (rows && rows.length > 0 ? rows : genMockUsage(30)),
    [liveRows, rows],
  )

  const models = useMemo(() => Array.from(new Set(allData.map((r) => r.model))), [allData])
  const [picked, setPicked] = useState<string[]>([])
  const active = useMemo(
    () => (picked.length > 0 ? allData.filter((r) => picked.includes(r.model)) : allData),
    [allData, picked],
  )

  const totals = tokensOf(active)
  const totalCost = active.reduce((a, r) => a + rowCost(r), 0)
  const totalReq = active.reduce((a, r) => a + (r.requests ?? 0), 0)
  const showReq = active.some((r) => typeof r.requests === 'number')
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
    setPicked((prev) => (prev.includes(model) ? prev.filter((x) => x !== model) : [...prev, model]))
  }

  const note =
    source === 'deepseek'
      ? '// 实时数据 · 来自 DeepSeek 平台用量'
      : source === 'invalid'
        ? '// DeepSeek 令牌失效,请在 /admin → DeepSeek 用量 重新同步'
        : usingMock
          ? '// 当前为 demo 数据;配置 DeepSeek 令牌(admin)后将显示真实用量'
          : '// 数据来自本地 usage 表'

  return (
    <Section id="usage" tag="// TOKEN USAGE" num="02" title="Token 用量">
      <div className="zx-seg" role="group" aria-label="时间范围">
        {RANGES.map((rg) => (
          <button
            key={rg}
            type="button"
            className={`zx-chip${range === rg ? ' is-active' : ''}`}
            onClick={() => setRange(rg)}
          >
            {rg}
          </button>
        ))}
      </div>

      <div className="zx-seg" role="group" aria-label="模型筛选">
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
        {showReq && (
          <div className="zx-stat">
            <div className="zx-stat-now">{fmtInt(totalReq)}</div>
            <div className="zx-stat-label">请求数</div>
          </div>
        )}
        <div className="zx-stat">
          <div className="zx-stat-now">{fmtCny(totalCost)}</div>
          <div className="zx-stat-label">成本 · {range}</div>
        </div>
      </div>

      <div className="zx-usage-charts">
        <div className="zx-panel">
          <h3>
            DAILY_TOKENS <span>近 {range} · input + output</span>
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

      <div className="zx-panel">
        <h3>
          RECENT <span>近 {range} 明细(按天/模型)</span>
        </h3>
        <table className="zx-table">
          <thead>
            <tr>
              <th>day</th>
              <th>model</th>
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
                <td className="zx-mono">{fmtDate(r.ts)}</td>
                <td>{modelLabel(r.model)}</td>
                <td className="num">{fmtInt(r.inputTokens)}</td>
                <td className="num">{fmtInt(r.outputTokens)}</td>
                <td className="num">{fmtInt(r.cacheHitTokens)}</td>
                {showReq && <td className="num">{fmtInt(r.requests ?? 0)}</td>}
                <td className="num">{fmtCny(rowCost(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', marginTop: '0.8rem' }}>
        {note}
      </p>
    </Section>
  )
}
