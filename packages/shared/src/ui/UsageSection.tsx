'use client'

import { useEffect, useMemo, useState } from 'react'
import { dailyAggregate, genMockUsage, modelAggregate } from '../mock.js'
import { PRICING, estimateCost, tokensOf } from '../pricing.js'
import type { UsageRow } from '../schema.js'
import { fmtCompact, fmtCny, fmtUsd, fmtDate, fmtInt } from '../format.js'
import { DEFAULT_SEL, defaultRangeSel, writeUsageSelCookie } from '../usage-sel.js'
import type { DataSource, Range, RangeSel, UsageSel } from '../usage-sel.js'
import { Section } from './Section.js'
import { useFeature } from './theme-context.js'

const modelColor = (model: string) => PRICING.find((p) => p.model === model)?.color ?? 'var(--accent)'
const modelLabel = (model: string) => PRICING.find((p) => p.model === model)?.label ?? model
const rowCost = (r: UsageRow) => (typeof r.cost === 'number' ? r.cost : estimateCost(r).total)

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

// 所有平台同一套模板:今天/昨天分时(hour),其余区间按天(day)
const SOURCES: { key: DataSource; label: string; hint: string }[] = [
  { key: 'deepseek', label: 'DeepSeek', hint: '官方数据源 · 今天/昨天分时' },
  { key: 'opencode', label: 'OpenCode', hint: '官方数据源 · 今天/昨天分时' },
]

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const mergeUnique = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]))

interface GoQuotaWindow {
  percent: number
  status?: string
  resetsAt?: string
}
interface GoQuota {
  rolling?: GoQuotaWindow
  weekly?: GoQuotaWindow
  monthly?: GoQuotaWindow
}

export function UsageSection({
  rows,
  window: ssrWin,
  initialSel,
}: {
  rows?: UsageRow[]
  window?: { start?: string; end?: string }
  initialSel?: UsageSel
}) {
  const showOc = useFeature('usage-opencode')
  const [dataSrc, setDataSrc] = useState<DataSource>(initialSel?.dataSrc ?? DEFAULT_SEL.dataSrc)
  const [live, setLive] = useState<UsageRow[] | null>(null)
  const [fetchedFor, setFetchedFor] = useState<{ range: Range; src: DataSource } | null>(null)
  const [source, setSource] = useState<'server' | 'deepseek' | 'opencode' | 'stale' | 'local' | 'none' | 'unconfigured' | 'invalid' | 'error'>('server')
  const [granularity, setGranularity] = useState<'day' | 'hour'>('day')
  const hourMode = granularity === 'hour'
  const [platformLimit, setPlatformLimit] = useState(false)
  const [currency, setCurrency] = useState<'CNY' | 'USD'>('CNY')
  const [at, setAt] = useState<number | undefined>()
  const [lastError, setLastError] = useState<string | undefined>()
  const [goQuota, setGoQuota] = useState<GoQuota | null>(null)
  const [win, setWin] = useState<{ start?: string; end?: string }>(ssrWin ?? {})
  const [knownModels, setKnownModels] = useState<Record<DataSource, string[]>>({ deepseek: [], opencode: [] })
  // 区间/自定义日期按数据源各自保存:切源自动切到该源的一套
  const [per, setPer] = useState<Record<DataSource, RangeSel>>(initialSel?.per ?? DEFAULT_SEL.per)
  const [pickedKeys, setPickedKeys] = useState<Record<DataSource, string[]>>(initialSel?.pickedKeys ?? DEFAULT_SEL.pickedKeys)
  const [knownKeys, setKnownKeys] = useState<Record<DataSource, string[]>>({ deepseek: [], opencode: [] })
  const [picked, setPicked] = useState<Record<DataSource, string[]>>(initialSel?.picked ?? DEFAULT_SEL.picked)
  const curPicked = picked[dataSrc] ?? []
  const curPickedKeys = pickedKeys[dataSrc] ?? []
  const curRangeSel = per[dataSrc] ?? defaultRangeSel()
  const range = curRangeSel.range
  const customStart = curRangeSel.customStart
  const customEnd = curRangeSel.customEnd
  const customApplied = curRangeSel.customApplied
  const patchRangeSel = (patch: Partial<RangeSel>) =>
    setPer((prev) => ({ ...prev, [dataSrc]: { ...(prev[dataSrc] ?? defaultRangeSel()), ...patch } }))

  // 任一筛选变化即写入存档 cookie(服务端随后用它渲染首帧,客户端再写入保持同步)
  useEffect(() => {
    writeUsageSelCookie({ dataSrc, per, picked, pickedKeys })
  }, [dataSrc, per, picked, pickedKeys])

  useEffect(() => {
    if (rows?.length) {
      setKnownModels((prev) => ({ ...prev, deepseek: mergeUnique(prev.deepseek, rows.map((r) => r.model)) }))
      setKnownKeys((prev) => ({
        ...prev,
        deepseek: mergeUnique(prev.deepseek, rows.map((r) => r.apiKey ?? '').filter(Boolean)),
      }))
    }
  }, [rows])

  useEffect(() => {
    let alive = true
    const src = dataSrc
    let url = `/api/usage?range=${range}&source=${src}`
    if (range === 'custom') {
      if (!customApplied) return
      url += `&start=${customApplied.start}&end=${customApplied.end}`
    }
    fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { source?: string; rows?: UsageRow[]; models?: string[]; apiKeys?: string[]; currency?: string; at?: number; lastError?: string; start?: string; end?: string; granularity?: 'hour' | 'day'; platformLimit?: boolean; goQuota?: GoQuota | null }) => {
        if (!alive) return
        const s = (d.source as typeof source) || 'none'
        setSource(s)
        setGranularity(d.granularity === 'hour' ? 'hour' : 'day')
        setPlatformLimit(!!d.platformLimit)
        setCurrency(d.currency === 'USD' ? 'USD' : 'CNY')
        setAt(d.at)
        setLastError(d.lastError)
        setGoQuota(d.goQuota ?? null)
        setWin({ start: d.start, end: d.end })
        setLive(d.rows ?? [])
        setFetchedFor({ range, src })
        setKnownModels((prev) => ({
          ...prev,
          [src]: mergeUnique(prev[src], [...(d.models ?? []), ...(d.rows ?? []).map((x) => x.model)]),
        }))
        setKnownKeys((prev) => ({
          ...prev,
          [src]: mergeUnique(prev[src], [
            ...(d.apiKeys ?? []),
            ...(d.rows ?? []).map((x) => x.apiKey ?? '').filter(Boolean),
          ]),
        }))
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
  }, [range, customApplied, dataSrc])

  const serverRows = dataSrc === 'deepseek' && rows && rows.length > 0 ? rows : null
  const fetchedLive = fetchedFor?.range === range && fetchedFor?.src === dataSrc && live !== null
  const allData = useMemo(() => {
    if (fetchedLive) return live ?? []
    if (dataSrc === 'opencode') return [] // opencode 只展示实时拉取,避免混入 DeepSeek 数据
    return serverRows ?? genMockUsage(30)
  }, [fetchedLive, live, serverRows, dataSrc])
  const usingMock = dataSrc === 'deepseek' && !fetchedLive && !serverRows

  const dataModels = useMemo(() => {
    const s = new Set<string>()
    for (const r of allData) {
      if (usingMock || r.inputTokens + r.outputTokens > 0 || (r.cost ?? 0) > 0) s.add(r.model)
    }
    return s
  }, [allData, usingMock])
  // 模型选单按使用频率(区间内 tokens 总量)从高到低排;零用量(如 DeepSeek 置灰模型)排最后
  const modelUsage = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of allData) {
      m.set(r.model, (m.get(r.model) ?? 0) + r.inputTokens + r.outputTokens + (r.cacheHitTokens ?? 0))
    }
    return m
  }, [allData])
  const models = useMemo(() => {
    return Array.from(new Set([...(knownModels[dataSrc] ?? []), ...dataModels])).sort((a, b) => {
      const ta = modelUsage.get(a) ?? 0
      const tb = modelUsage.get(b) ?? 0
      return tb !== ta ? tb - ta : a.localeCompare(b)
    })
  }, [knownModels, dataModels, modelUsage, dataSrc])

  const dataKeys = useMemo(() => {
    const s = new Set<string>()
    for (const r of allData) {
      const k = r.apiKey
      if (k && (usingMock || r.inputTokens + r.outputTokens > 0 || (r.cost ?? 0) > 0 || (r.requests ?? 0) > 0)) s.add(k)
    }
    return s
  }, [allData, usingMock])
  const keys = useMemo(
    () => Array.from(new Set([...(knownKeys[dataSrc] ?? []), ...dataKeys])),
    [knownKeys, dataKeys, dataSrc],
  )
  const hasKey = useMemo(() => allData.some((r) => !!r.apiKey), [allData])

  const active = useMemo(() => {
    let arr = allData
    if (curPicked.length > 0) arr = arr.filter((r) => curPicked.includes(r.model))
    if (curPickedKeys.length > 0) arr = arr.filter((r) => (r.apiKey ?? '') && curPickedKeys.includes(r.apiKey ?? ''))
    return arr
  }, [allData, curPicked, curPickedKeys])

  // 分时显示:今天/昨天在所有数据源都画 24 根小时柱(北京时);其余区间按天
  const fmtCost = currency === 'USD' ? fmtUsd : fmtCny
  const rowLabel = (r: UsageRow) =>
    hourMode ? `${fmtDate(r.ts)} ${r.ts.slice(11, 13)}:00` : fmtDate(r.ts)
  const keyLabel = dataSrc === 'opencode' ? 'provider' : 'key'

  const totals = tokensOf(active)
  const totalCost = active.reduce((a, r) => a + rowCost(r), 0)
  const totalReq = active.reduce((a, r) => a + (r.requests ?? 0), 0)
  const showReq = active.some((r) => typeof r.requests === 'number')
  const daily = dailyAggregate(active)
  const daySeries = useMemo(() => {
    if (hourMode) {
      const day = win.start || (active.length ? active[0].ts.slice(0, 10) : '')
      if (!day) return []
      const byHour = new Map<string, [number, number]>()
      for (const r of active) {
        const h = r.ts.slice(11, 13)
        const hit = byHour.get(h) ?? [0, 0]
        hit[0] += r.inputTokens
        hit[1] += r.outputTokens
        byHour.set(h, hit)
      }
      const out: Array<[string, number, number]> = []
      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, '0')
        const hit = byHour.get(hh)
        out.push(hit ? [`${day}T${hh}:00:00Z`, hit[0], hit[1]] : [`${day}T${hh}:00:00Z`, 0, 0])
      }
      return out
    }
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
  }, [hourMode, active, daily, win])

  const altDays = useMemo(() => {
    const set = new Set<string>()
    let count = 0
    for (const [dt, input, output] of daySeries) {
      if (input + output > 0 && ++count % 6 === 0) set.add(dt)
    }
    return set
  }, [daySeries])
  const altFor = (dt: string) => altDays.has(dt)
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
    setPicked((prev) => {
      const list = prev[dataSrc] ?? []
      return { ...prev, [dataSrc]: list.includes(model) ? list.filter((x) => x !== model) : [...list, model] }
    })
  }

  function toggleKey(k: string) {
    setPickedKeys((prev) => {
      const list = prev[dataSrc] ?? []
      return { ...prev, [dataSrc]: list.includes(k) ? list.filter((x) => x !== k) : [...list, k] }
    })
  }

  function clearPicked() {
    setPicked((prev) => ({ ...prev, [dataSrc]: [] }))
  }

  function clearPickedKeys() {
    setPickedKeys((prev) => ({ ...prev, [dataSrc]: [] }))
  }

  function onRange(r: Range) {
    if (r === 'custom' && !customStart && !customEnd) {
      patchRangeSel({
        range: r,
        customStart: localIso(new Date(Date.now() - 6 * 86400000)),
        customEnd: localIso(new Date()),
      })
      return
    }
    patchRangeSel({ range: r })
  }

  function applyCustom() {
    if (!customStart || !customEnd) return
    const start = customStart <= customEnd ? customStart : customEnd
    const end = customStart <= customEnd ? customEnd : customStart
    patchRangeSel({ customApplied: { start, end } })
  }

  const fmtAt = (t?: number) => (t ? new Date(t).toLocaleString() : '—')
  const rangeWin = win.start && win.end ? `${win.start} ~ ${win.end}` : ''
  const note = (() => {
    const srcName = dataSrc === 'opencode' ? 'OpenCode 官方 Console' : 'DeepSeek 平台'
    if (dataSrc === 'opencode' && !fetchedLive) {
      if (source === 'unconfigured')
        return `// OpenCode:未配置服务账号 Key(admin 设 OPENCODE_SERVICE_KEY 或在「Token 用量」里粘贴 oc_sk_…)${lastError ? ` · ${lastError}` : ''}`
      if (source === 'invalid' || source === 'error')
        return `// OpenCode:${lastError ? `拉取失败:${lastError}` : '拉取失败'}`
      return `// OpenCode:读取官方 Console · ${lastError ? `错误:${lastError}` : '加载中…'}`
    }
    if (!fetchedLive) {
      if (usingMock) return '// 当前为 demo 数据;配置 DeepSeek 令牌(admin)或接入上报后显示真实用量'
      return `// 数据来自本地 usage 表(服务端) · 更新于 ${fmtAt(at)}`
    }
    if (source === 'invalid' || source === 'error') return `// demo 数据 · ${srcName} 拉取失败:${lastError ?? '未知'}`
    if (source === 'unconfigured') return `// OpenCode 未配置服务账号 Key(${lastError ?? ''})`
    if (source === 'stale') return `// 上次成功数据(拉取失败:${lastError ?? '未知'}) · 更新于 ${fmtAt(at)}`
    if (source === 'local') return `// 数据来自本地 usage 表(上报) · 更新于 ${fmtAt(at)}`
    if (live && live.length === 0) {
      return `// 该区间暂无真实数据${platformLimit ? '(官方数据源仅保留近 30 天,已超出覆盖)' : ''} · 更新于 ${fmtAt(at)}`
    }
    if (hourMode)
      return `// 实时数据 · ${srcName} 分时(UTC+8,按小时)${rangeWin ? ` · ${rangeWin}` : ''} · 更新于 ${fmtAt(at)}`
    return `// 实时数据 · 来自 ${srcName}${rangeWin ? ` · ${rangeWin}` : ''} · 更新于 ${fmtAt(at)}`
  })()

  return (
    <Section id="usage" tag="// TOKEN USAGE" num="02" title="Token 用量">
      {showOc && (
        <div className="zx-seg" role="group" aria-label="数据源">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`zx-chip${dataSrc === s.key ? ' is-active' : ''}`}
              onClick={() => setDataSrc(s.key)}
            >
              {s.label}
              <span className="zx-muted zx-mono" style={{ fontSize: '0.6rem', marginLeft: '0.35rem' }}>
                {s.hint}
              </span>
            </button>
          ))}
        </div>
      )}

      {dataSrc === 'opencode' && goQuota && (
        <div className="zx-quota">
          {(
            [
              ['5 小时', goQuota.rolling],
              ['本周', goQuota.weekly],
              ['本月', goQuota.monthly],
            ] as const
          ).map(([label, w]) => {
            const pct = Math.max(0, Math.min(100, Math.round(w?.percent ?? 0)))
            const reset = w?.resetsAt ? new Date(w.resetsAt) : null
            const resetTxt = reset
              ? reset.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : ''
            return (
              <div className="zx-quota-item" key={label}>
                <div className="zx-quota-head">
                  <span className="zx-quota-label">Go · {label}</span>
                  <span className="zx-quota-pct">{pct}%</span>
                </div>
                <div className="zx-quota-bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
                {resetTxt && <div className="zx-quota-reset zx-muted zx-mono">重置 {resetTxt}</div>}
              </div>
            )
          })}
        </div>
      )}

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
            onChange={(e) => patchRangeSel({ customStart: e.target.value })}
          />
          <span className="zx-muted zx-mono">→</span>
          <input
            type="date"
            className="zx-input"
            style={{ width: 'auto' }}
            value={customEnd}
            onChange={(e) => patchRangeSel({ customEnd: e.target.value })}
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
          className={`zx-chip${curPicked.length === 0 ? ' is-active' : ''}`}
          onClick={clearPicked}
        >
          整体用量
        </button>
        {models.map((m) => (
          <button
            key={m}
            type="button"
            className={`zx-chip${curPicked.includes(m) ? ' is-active' : ''}${!usingMock && !dataModels.has(m) ? ' is-empty' : ''}`}
            onClick={() => toggle(m)}
          >
            <span className="zx-legend-dot" style={{ background: modelColor(m), color: modelColor(m) }} />
            {modelLabel(m)}
          </button>
        ))}
      </div>

      {keys.length > 0 && (
        <div className="zx-seg" role="group" aria-label={dataSrc === 'opencode' ? '提供方筛选' : 'API Key 筛选'}>
          <button
            type="button"
            className={`zx-chip${curPickedKeys.length === 0 ? ' is-active' : ''}`}
            onClick={clearPickedKeys}
          >
            {dataSrc === 'opencode' ? '全部提供方' : '全部 API Key'}
          </button>
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              className={`zx-chip${curPickedKeys.includes(k) ? ' is-active' : ''}${!usingMock && !dataKeys.has(k) ? ' is-empty' : ''}`}
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
          <div className="zx-stat-now">{fmtCost(totalCost)}</div>
          <div className="zx-stat-label">成本 · {rangeLabel(range)}</div>
        </div>
      </div>

      <div className="zx-usage-charts">
        <div className="zx-panel">
          <h3>
            {hourMode ? 'HOURLY_TOKENS' : 'DAILY_TOKENS'}{' '}
            <span>
              {hourMode ? '一天内分时 · UTC+8 · input + output' : `${rangeLabel(range)} · input + output`}
            </span>
          </h3>
          <div className="zx-bars">
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
        </div>

        <div className="zx-panel">
          <h3>
            BY_MODEL <span>{curPicked.length > 0 ? '所选模型' : 'tokens 占比'}</span>
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
          RECENT{' '}
          <span>
            {rangeLabel(range)}
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
                {hasKey && <td className="zx-mono">{r.apiKey || '—'}</td>}
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

      <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', marginTop: '0.8rem' }}>
        {note}
      </p>
    </Section>
  )
}