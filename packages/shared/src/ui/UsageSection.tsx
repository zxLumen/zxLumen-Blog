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

type Range = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastmonth' | 'custom'
const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
  { key: 'month', label: '本月' },
  { key: 'lastmonth', label: '上月' },
  { key: 'custom', label: '自定义' },
]
const rangeLabel = (r: Range) => RANGES.find((x) => x.key === r)?.label ?? r

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function UsageSection({ rows, window: ssrWin }: { rows?: UsageRow[]; window?: { start?: string; end?: string } }) {
  const [range, setRange] = useState<Range>('30d')
  const [live, setLive] = useState<UsageRow[] | null>(null)
  const [fetchedFor, setFetchedFor] = useState<Range | null>(null)
  const [source, setSource] = useState<'server' | 'deepseek' | 'stale' | 'local' | 'none' | 'invalid' | 'error'>('server')
  const [at, setAt] = useState<number | undefined>()
  const [lastError, setLastError] = useState<string | undefined>()
  const [win, setWin] = useState<{ start?: string; end?: string }>(ssrWin ?? {})
  const [knownModels, setKnownModels] = useState<string[]>([])
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [customApplied, setCustomApplied] = useState<{ start: string; end: string } | null>(null)
  const [pickedKeys, setPickedKeys] = useState<string[]>([])
  const [knownKeys, setKnownKeys] = useState<string[]>([])

  useEffect(() => {
    if (rows?.length) {
      setKnownModels((prev) => Array.from(new Set([...prev, ...rows.map((r) => r.model)])))
      setKnownKeys((prev) =>
        Array.from(new Set([...prev, ...rows.map((r) => r.apiKey ?? '').filter(Boolean)])),
      )
    }
  }, [rows])

  useEffect(() => {
    let alive = true
    let url = `/api/usage?range=${range}`
    if (range === 'custom') {
      if (!customApplied) return
      url += `&start=${customApplied.start}&end=${customApplied.end}`
    }
    fetch(url, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { source?: string; rows?: UsageRow[]; models?: string[]; apiKeys?: string[]; at?: number; lastError?: string; start?: string; end?: string }) => {
        if (!alive) return
        const s = (d.source as typeof source) || 'none'
        setSource(s)
        setAt(d.at)
        setLastError(d.lastError)
        setWin({ start: d.start, end: d.end })
        setLive(d.rows ?? [])
        setFetchedFor(range)
        setKnownModels((prev) =>
          Array.from(new Set([...prev, ...(d.models ?? []), ...(d.rows ?? []).map((x) => x.model)])),
        )
        setKnownKeys((prev) =>
          Array.from(new Set([...prev, ...(d.apiKeys ?? []), ...(d.rows ?? []).map((x) => x.apiKey ?? '').filter(Boolean)])),
        )
      })
      .catch(() => {
        if (alive) {
          setLive(null)
          setFetchedFor(null)
          setSource('error')
        }
      })
    return () => {
      alive = false
    }
  }, [range, customApplied])

  const serverRows = rows && rows.length > 0 ? rows : null
  const fetchedLive = fetchedFor === range && live !== null
  const allData = useMemo(() => {
    if (fetchedLive) return live ?? []
    return serverRows ?? genMockUsage(30)
  }, [fetchedLive, live, serverRows])
  const usingMock = !fetchedLive && !serverRows

  const dataModels = useMemo(() => {
    const s = new Set<string>()
    for (const r of allData) {
      if (usingMock || r.inputTokens + r.outputTokens > 0 || (r.cost ?? 0) > 0) s.add(r.model)
    }
    return s
  }, [allData, usingMock])
  const models = useMemo(() => Array.from(new Set([...knownModels, ...dataModels])), [knownModels, dataModels])

  const dataKeys = useMemo(() => {
    const s = new Set<string>()
    for (const r of allData) {
      const k = r.apiKey
      if (k && (usingMock || r.inputTokens + r.outputTokens > 0 || (r.cost ?? 0) > 0 || (r.requests ?? 0) > 0)) s.add(k)
    }
    return s
  }, [allData, usingMock])
  const keys = useMemo(() => Array.from(new Set([...knownKeys, ...dataKeys])), [knownKeys, dataKeys])
  const hasKey = useMemo(() => allData.some((r) => !!r.apiKey), [allData])

  const [picked, setPicked] = useState<string[]>([])
  const active = useMemo(() => {
    let arr = allData
    if (picked.length > 0) arr = arr.filter((r) => picked.includes(r.model))
    if (pickedKeys.length > 0) arr = arr.filter((r) => (r.apiKey ?? '') && pickedKeys.includes(r.apiKey ?? ''))
    return arr
  }, [allData, picked, pickedKeys])

  const totals = tokensOf(active)
  const totalCost = active.reduce((a, r) => a + rowCost(r), 0)
  const totalReq = active.reduce((a, r) => a + (r.requests ?? 0), 0)
  const showReq = active.some((r) => typeof r.requests === 'number')
  const daily = dailyAggregate(active)
  const daySeries = useMemo(() => {
    let start = win.start
    let end = win.end
    if (!start || !end) {
      const days = daily.map((d) => d[0])
      if (days.length) {
        start = days.reduce((a, b) => (a < b ? a : b))
        end = days.reduce((a, b) => (a > b ? a : b))
      }
    }
    if (!start || !end) return daily.map((d) => [d[0], d[1], d[2]]) as Array<[string, number, number]>
    const map = new Map<string, [number, number]>()
    for (const d of daily) map.set(d[0], [d[1], d[2]])
    const out: Array<[string, number, number]> = []
    const [sy, sm, sd] = start.split('-').map(Number)
    const [ey, em, ed] = end.split('-').map(Number)
    for (let t = Date.UTC(sy, sm - 1, sd); t <= Date.UTC(ey, em - 1, ed); t += 86400000) {
      const iso = new Date(t).toISOString().slice(0, 10)
      const hit = map.get(iso)
      out.push(hit ? [iso, hit[0], hit[1]] : [iso, 0, 0])
    }
    return out
  }, [daily, win])

  const altDays = useMemo(() => {
    const set = new Set<string>()
    let count = 0
    for (const [day, input, output] of daySeries) {
      if (input + output > 0 && ++count % 6 === 0) set.add(day)
    }
    return set
  }, [daySeries])
  const altFor = (day: string) => altDays.has(day)
  const byModel = modelAggregate(active)
  const maxDaily = Math.max(1, ...daySeries.map((d) => d[1] + d[2]))
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

  function toggleKey(k: string) {
    setPickedKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  function onRange(r: Range) {
    setRange(r)
    if (r === 'custom' && !customStart && !customEnd) {
      setCustomStart(localIso(new Date(Date.now() - 6 * 86400000)))
      setCustomEnd(localIso(new Date()))
    }
  }

  function applyCustom() {
    if (!customStart || !customEnd) return
    const start = customStart <= customEnd ? customStart : customEnd
    const end = customStart <= customEnd ? customEnd : customStart
    setCustomApplied({ start, end })
  }

  const fmtAt = (t?: number) => (t ? new Date(t).toLocaleString() : '—')
  const rangeWin = win.start && win.end ? `${win.start} ~ ${win.end}` : ''
  const note = (() => {
    if (!fetchedLive) {
      if (usingMock) return '// 当前为 demo 数据;配置 DeepSeek 令牌(admin)或接入上报后显示真实用量'
      return `// 数据来自本地 usage 表(服务端) · 更新于 ${fmtAt(at)}`
    }
    if (source === 'invalid' || source === 'error') return `// demo 数据 · DeepSeek 拉取失败:${lastError ?? '未知'}`
    if (source === 'stale') return `// 上次同步数据(拉取失败:${lastError ?? '未知'}) · 更新于 ${fmtAt(at)}`
    if (source === 'local') return `// 数据来自本地 usage 表(上报) · 更新于 ${fmtAt(at)}`
    if (live && live.length === 0) return `// 该区间暂无真实数据(平台按天结算,当天数据可能有延迟)· 更新于 ${fmtAt(at)}`
    return `// 实时数据 · 来自 DeepSeek 平台用量${rangeWin ? ` · ${rangeWin}` : ''} · 更新于 ${fmtAt(at)}`
  })()

  return (
    <Section id="usage" tag="// TOKEN USAGE" num="02" title="Token 用量">
      <div className="zx-seg" role="group" aria-label="时间范围">
        {RANGES.map((rg) => (
          <button
            key={rg.key}
            type="button"
            className={`zx-chip${range === rg.key ? ' is-active' : ''}`}
            onClick={() => onRange(rg.key)}
          >
            {rg.label}
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div className="zx-seg" role="group" aria-label="自定义日期">
          <input
            type="date"
            className="zx-input"
            style={{ width: 'auto' }}
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
          <span className="zx-muted zx-mono">→</span>
          <input
            type="date"
            className="zx-input"
            style={{ width: 'auto' }}
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
          <button
            type="button"
            className="zx-chip is-active"
            onClick={applyCustom}
            disabled={!customStart || !customEnd || (customApplied?.start === customStart && customApplied?.end === customEnd)}
          >
            应用
          </button>
        </div>
      )}

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
            className={`zx-chip${picked.includes(m) ? ' is-active' : ''}${!usingMock && !dataModels.has(m) ? ' is-empty' : ''}`}
            onClick={() => toggle(m)}
          >
            <span className="zx-legend-dot" style={{ background: modelColor(m), color: modelColor(m) }} />
            {modelLabel(m)}
          </button>
        ))}
      </div>

      {keys.length > 0 && (
        <div className="zx-seg" role="group" aria-label="API Key 筛选">
          <button
            type="button"
            className={`zx-chip${pickedKeys.length === 0 ? ' is-active' : ''}`}
            onClick={() => setPickedKeys([])}
          >
            全部 API Key
          </button>
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              className={`zx-chip${pickedKeys.includes(k) ? ' is-active' : ''}${!usingMock && !dataKeys.has(k) ? ' is-empty' : ''}`}
              onClick={() => toggleKey(k)}
            >
              {k}
            </button>
          ))}
        </div>
      )}

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
          <div className="zx-stat-label">成本 · {rangeLabel(range)}</div>
        </div>
      </div>

      <div className="zx-usage-charts">
        <div className="zx-panel">
          <h3>
            DAILY_TOKENS <span>{rangeLabel(range)} · input + output</span>
          </h3>
          <div className="zx-bars">
            {daySeries.map(([day, input, output]) => {
              const v = input + output
              return (
                <div
                  key={day}
                  className={`zx-bar${v === 0 ? ' is-zero' : altFor(day) ? ' is-alt' : ''}`}
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
          RECENT <span>{rangeLabel(range)}{rangeWin ? ` · ${rangeWin}` : ''} 明细(按天/模型)</span>
        </h3>
        <table className="zx-table">
          <thead>
            <tr>
              <th>day</th>
              <th>model</th>
              {hasKey && <th>key</th>}
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
                {hasKey && <td className="zx-mono">{r.apiKey || '—'}</td>}
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