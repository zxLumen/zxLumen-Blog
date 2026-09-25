'use client'

import { useEffect, useMemo, useState } from 'react'
import { dailyAggregate, genMockUsage, modelAggregate } from '../mock.js'
import { tokensOf } from '../pricing.js'
import type { UsageRow } from '../schema.js'
import { fmtCompact, fmtCny, fmtUsd, fmtDate, fmtInt } from '../format.js'
import { DEFAULT_SEL, defaultRangeSel, writeUsageSelCookie } from '../usage-sel.js'
import type { DataSource, Range, RangeSel, UsageSel } from '../usage-sel.js'
import { Section } from './Section.js'
import {
  localIso,
  mergeUnique,
  modelColor,
  modelLabel,
  rangeLabel,
  rowCost,
  RANGES,
  SOURCES,
  type GoQuota,
  type ZhipuQuota,
} from './usage/constants.js'
import { GoQuotaPanel, ZhipuQuotaPanel } from './usage/QuotaPanels.js'
import { RecentTable, UsageCharts } from './usage/UsageCharts.js'
import { Pagination } from './Pagination.js'

export function UsageSection({
  rows,
  window: ssrWin,
  initialSel,
  availableSources,
}: {
  rows?: UsageRow[]
  window?: { start?: string; end?: string }
  initialSel?: UsageSel
  /** SSR 计算的数据源可用性;未提供则客户端探测 */
  availableSources?: Partial<Record<DataSource, boolean>>
}) {
  const [dataSrc, setDataSrc] = useState<DataSource>(initialSel?.dataSrc ?? DEFAULT_SEL.dataSrc)
  // RECENT 明细表翻页
  const [recentPage, setRecentPage] = useState(1)
  const [recentPageSize, setRecentPageSize] = useState(10)
  // 各源可用性(已配置 + 近30天有数据);null=未知(按 feature 放行)
  const [avail, setAvail] = useState<Record<DataSource, boolean> | null>(
    availableSources ? (availableSources as Record<DataSource, boolean>) : null,
  )
  useEffect(() => {
    if (availableSources) return
    let alive = true
    fetch('/api/usage/sources', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Record<DataSource, boolean> | null) => {
        if (alive && d) setAvail(d)
      })
      .catch(() => {
        /* 探测失败:不隐藏任何源 */
      })
    return () => {
      alive = false
    }
  }, [availableSources])
  // 仅显示可用的数据源(单环境:全部放行)
  const sources = useMemo(
    () =>
      SOURCES.filter((s) => {
        if (avail && !avail[s.key]) return false
        return true
      }),
    [avail],
  )
  // 当前源若被隐藏,回退到默认(DeepSeek)
  useEffect(() => {
    if (avail && !avail[dataSrc] && sources.length > 0 && dataSrc !== sources[0].key) {
      setDataSrc(sources[0].key)
    }
  }, [avail, dataSrc, sources])
  const [live, setLive] = useState<UsageRow[] | null>(null)
  const [fetchedFor, setFetchedFor] = useState<{ range: Range; src: DataSource } | null>(null)
  const [source, setSource] = useState<'server' | 'deepseek' | 'opencode' | 'zhipu' | 'stale' | 'local' | 'none' | 'unconfigured' | 'invalid' | 'error'>('server')
  const [granularity, setGranularity] = useState<'day' | 'hour'>('day')
  const hourMode = granularity === 'hour'
  const [platformLimit, setPlatformLimit] = useState(false)
  const [currency, setCurrency] = useState<'CNY' | 'USD'>('CNY')
  const [at, setAt] = useState<number | undefined>()
  const [lastError, setLastError] = useState<string | undefined>()
  const [zhipuQuota, setZhipuQuota] = useState<ZhipuQuota | null>(null)
  const [win, setWin] = useState<{ start?: string; end?: string }>(ssrWin ?? {})
  const [knownModels, setKnownModels] = useState<Record<DataSource, string[]>>({ deepseek: [], opencode: [], zhipu: [] })
  // 区间/自定义日期按数据源各自保存:切源自动切到该源的一套
  const [per, setPer] = useState<Record<DataSource, RangeSel>>(initialSel?.per ?? DEFAULT_SEL.per)
  const [pickedKeys, setPickedKeys] = useState<Record<DataSource, string[]>>(initialSel?.pickedKeys ?? DEFAULT_SEL.pickedKeys)
  const [knownKeys, setKnownKeys] = useState<Record<DataSource, string[]>>({ deepseek: [], opencode: [], zhipu: [] })
  const [picked, setPicked] = useState<Record<DataSource, string[]>>(initialSel?.picked ?? DEFAULT_SEL.picked)
  // OpenCode workspace 列表(来自接口)+ 选择(单选,空=全部/总用量)
  const [wsList, setWsList] = useState<{ id: string; name: string }[]>([])
  const [pickedWs, setPickedWs] = useState<Record<DataSource, string[]>>(initialSel?.pickedWs ?? DEFAULT_SEL.pickedWs)
  // OpenCode service account 筛选(多选,空=全部)
  const [pickedSa, setPickedSa] = useState<Record<DataSource, string[]>>(initialSel?.pickedSa ?? DEFAULT_SEL.pickedSa)
  const [goQuotas, setGoQuotas] = useState<{ name: string; quota: GoQuota | null }[]>([])
  const curPicked = picked[dataSrc] ?? []
  // opencode 不做「提供方」筛选:忽略(并清空)其选择,避免旧 cookie 残留仍偷偷过滤
  const curPickedKeys = dataSrc === 'opencode' ? [] : (pickedKeys[dataSrc] ?? [])
  const curPickedSa = pickedSa[dataSrc] ?? []
  const curPickedWs = (pickedWs[dataSrc] ?? []).slice(0, 1)
  // 稳定的 workspace 选择 key(字符串):用于 fetch 依赖,选择变化才重新拉取
  const wsKey = (pickedWs.opencode ?? []).slice(0, 1).join(',')
  const curRangeSel = per[dataSrc] ?? defaultRangeSel()
  const range = curRangeSel.range
  const customStart = curRangeSel.customStart
  const customEnd = curRangeSel.customEnd
  const customApplied = curRangeSel.customApplied
  const patchRangeSel = (patch: Partial<RangeSel>) =>
    setPer((prev) => ({ ...prev, [dataSrc]: { ...(prev[dataSrc] ?? defaultRangeSel()), ...patch } }))

  // 任一筛选变化即写入存档 cookie(服务端随后用它渲染首帧,客户端再写入保持同步)
  useEffect(() => {
    writeUsageSelCookie({ dataSrc, per, picked, pickedKeys: { ...pickedKeys, opencode: [] }, pickedWs, pickedSa })
  }, [dataSrc, per, picked, pickedKeys, pickedWs, pickedSa])

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
    if (src === 'opencode') {
      const sel = (pickedWs.opencode ?? []).slice(0, 1)
      if (sel.length > 0) url += `&ws=${sel.join(',')}`
    }
    void wsKey
    fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { source?: string; rows?: UsageRow[]; models?: string[]; apiKeys?: string[]; currency?: string; at?: number; lastError?: string; start?: string; end?: string; granularity?: 'hour' | 'day'; platformLimit?: boolean; goQuotas?: { name: string; quota: GoQuota | null }[]; zhipuQuota?: ZhipuQuota | null; workspaces?: { id: string; name: string }[] }) => {
        if (!alive) return
        const s = (d.source as typeof source) || 'none'
        setSource(s)
        setGranularity(d.granularity === 'hour' ? 'hour' : 'day')
        setPlatformLimit(!!d.platformLimit)
        setCurrency(d.currency === 'USD' ? 'USD' : 'CNY')
        setAt(d.at)
        setLastError(d.lastError)
        setGoQuotas(d.goQuotas ?? [])
        if (d.workspaces) setWsList(d.workspaces)
        setZhipuQuota(d.zhipuQuota ?? null)
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
  }, [range, customApplied, dataSrc, wsKey])

  const serverRows = dataSrc === 'deepseek' && rows && rows.length > 0 ? rows : null
  const fetchedLive = fetchedFor?.range === range && fetchedFor?.src === dataSrc && live !== null
  const allData = useMemo(() => {
    if (fetchedLive) return live ?? []
    if (dataSrc === 'opencode' || dataSrc === 'zhipu') return [] // 这两个源只展示实时拉取,避免混入 DeepSeek 数据
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
  const hasKey = useMemo(
    () => (dataSrc === 'opencode' ? allData.some((r) => !!r.serviceAccount) : allData.some((r) => !!r.apiKey)),
    [allData, dataSrc],
  )

  // OpenCode service account 清单(来自当前数据)
  const saList = useMemo(() => {
    const s = new Set<string>()
    for (const r of allData) if (r.serviceAccount) s.add(r.serviceAccount)
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [allData])

  const active = useMemo(() => {
    let arr = allData
    if (curPicked.length > 0) arr = arr.filter((r) => curPicked.includes(r.model))
    if (curPickedKeys.length > 0) arr = arr.filter((r) => (r.apiKey ?? '') && curPickedKeys.includes(r.apiKey ?? ''))
    if (curPickedSa.length > 0)
      arr = arr.filter((r) => (r.serviceAccount ?? '') && curPickedSa.includes(r.serviceAccount ?? ''))
    return arr
  }, [allData, curPicked, curPickedKeys, curPickedSa])

  // 分时显示:今天/昨天在所有数据源都画 24 根小时柱(北京时);其余区间按天
  const fmtCost = currency === 'USD' ? fmtUsd : fmtCny
  const rowLabel = (r: UsageRow) =>
    hourMode ? `${fmtDate(r.ts)} ${r.ts.slice(11, 13)}:00` : fmtDate(r.ts)
  const keyLabel = dataSrc === 'opencode' ? 'service account' : 'key'
  // RECENT 明细的 key 列取值:opencode 显示服务账号(多工作区已带 `工作区 · ` 前缀),其余显示 apiKey
  const keyOf = (r: UsageRow) => (dataSrc === 'opencode' ? r.serviceAccount ?? '' : r.apiKey ?? '')

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

  const sortedRecent = useMemo(() => [...active].sort((a, b) => (a.ts < b.ts ? 1 : -1)), [active])
  const recentTotal = sortedRecent.length
  const recentTotalPages = Math.max(1, Math.ceil(recentTotal / recentPageSize))
  const recentPageClamped = Math.min(recentPage, recentTotalPages)
  const recent = sortedRecent.slice((recentPageClamped - 1) * recentPageSize, recentPageClamped * recentPageSize)

  // 切换数据源/区间/筛选时 RECENT 回到第 1 页(用字符串 key 保证依赖稳定)
  const recentResetKey = [
    dataSrc,
    range,
    customApplied?.start ?? '',
    customApplied?.end ?? '',
    curPicked.join(','),
    curPickedKeys.join(','),
    curPickedSa.join(','),
    curPickedWs.join(','),
  ].join('|')
  useEffect(() => {
    setRecentPage(1)
  }, [recentResetKey])

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

  function toggleSa(sa: string) {
    setPickedSa((prev) => {
      const list = prev[dataSrc] ?? []
      return { ...prev, [dataSrc]: list.includes(sa) ? list.filter((x) => x !== sa) : [...list, sa] }
    })
  }

  function clearPickedSa() {
    setPickedSa((prev) => ({ ...prev, [dataSrc]: [] }))
  }

  // workspace 单选:点已选中的即取消(回到「全部」)
  function toggleWs(id: string) {
    setPickedWs((prev) => {
      const list = prev[dataSrc] ?? []
      return { ...prev, [dataSrc]: list.includes(id) ? [] : [id] }
    })
  }

  function clearPickedWs() {
    setPickedWs((prev) => ({ ...prev, [dataSrc]: [] }))
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
    const srcName = dataSrc === 'opencode' ? 'OpenCode 官方 Console' : dataSrc === 'zhipu' ? '智谱 monitor API' : 'DeepSeek 平台'
    if (dataSrc === 'opencode' && !fetchedLive) {
      if (source === 'unconfigured')
        return `// OpenCode:未配置 workspace(在 admin「Token用量」里添加 workspace + oc_sk_ Key)${lastError ? ` · ${lastError}` : ''}`
      if (source === 'invalid' || source === 'error')
        return `// OpenCode:${lastError ? `拉取失败:${lastError}` : '拉取失败'}`
      return `// OpenCode:读取官方 Console · ${lastError ? `错误:${lastError}` : '加载中…'}`
    }
    if (dataSrc === 'zhipu' && !fetchedLive) {
      if (source === 'unconfigured')
        return `// 智谱:未配置 API Key(admin 设 ZHIPU_API_KEY 或在「Token用量」里粘贴)${lastError ? ` · ${lastError}` : ''}`
      if (source === 'invalid' || source === 'error')
        return `// 智谱:${lastError ? `拉取失败:${lastError}` : '拉取失败'}`
      return `// 智谱:读取 monitor API · ${lastError ? `错误:${lastError}` : '加载中…'}`
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
    if (dataSrc === 'zhipu')
      return `// 实时数据 · 智谱 monitor API(区间内按模型 token 总量)${rangeWin ? ` · ${rangeWin}` : ''} · 更新于 ${fmtAt(at)}`
    if (hourMode)
      return `// 实时数据 · ${srcName} 分时(UTC+8,按小时)${rangeWin ? ` · ${rangeWin}` : ''} · 更新于 ${fmtAt(at)}`
    return `// 实时数据 · 来自 ${srcName}${rangeWin ? ` · ${rangeWin}` : ''} · 更新于 ${fmtAt(at)}`
  })()

  return (
    <Section id="usage" tag="// TOKEN USAGE" num="02" title="Token用量">
      {sources.length > 1 && (
        <div className="zx-seg" role="group" aria-label="数据源">
          {sources.map((s) => (
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

      {dataSrc === 'opencode' && wsList.length > 0 && (
        <div className="zx-seg" role="group" aria-label="workspace 筛选">
          <button
            type="button"
            className={`zx-chip${curPickedWs.length === 0 ? ' is-active' : ''}`}
            onClick={clearPickedWs}
          >
            全部 workspace
          </button>
          {wsList.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`zx-chip${curPickedWs.includes(w.id) ? ' is-active' : ''}`}
              onClick={() => toggleWs(w.id)}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}

      {dataSrc === 'opencode' && goQuotas.length > 0 && <GoQuotaPanel quotas={goQuotas} />}

      {dataSrc === 'zhipu' && zhipuQuota && zhipuQuota.limits.length > 0 && (
        <ZhipuQuotaPanel quota={zhipuQuota} />
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

      {dataSrc === 'opencode' && saList.length > 0 && (
        <div className="zx-seg" role="group" aria-label="服务账号筛选">
          <button
            type="button"
            className={`zx-chip${curPickedSa.length === 0 ? ' is-active' : ''}`}
            onClick={clearPickedSa}
          >
            全部服务账号
          </button>
          {saList.map((sa) => (
            <button
              key={sa}
              type="button"
              className={`zx-chip${curPickedSa.includes(sa) ? ' is-active' : ''}`}
              onClick={() => toggleSa(sa)}
            >
              {sa}
            </button>
          ))}
        </div>
      )}

      {keys.length > 0 && dataSrc !== 'opencode' && (
        <div className="zx-seg" role="group" aria-label="API Key 筛选">
          <button
            type="button"
            className={`zx-chip${curPickedKeys.length === 0 ? ' is-active' : ''}`}
            onClick={clearPickedKeys}
          >
            全部 API Key
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

      <UsageCharts
        hourMode={hourMode}
        rangeLabel={rangeLabel(range)}
        daySeries={daySeries}
        altFor={altFor}
        maxDaily={maxDaily}
        byModel={byModel}
        hasPicked={curPicked.length > 0}
      />

      <RecentTable
        hourMode={hourMode}
        rangeLabel={rangeLabel(range)}
        rangeWin={rangeWin}
        recent={recent}
        hasKey={hasKey}
        keyLabel={keyLabel}
        keyOf={keyOf}
        showReq={showReq}
        rowLabel={rowLabel}
        fmtCost={fmtCost}
      />
      <Pagination
        page={recentPageClamped}
        totalPages={recentTotalPages}
        total={recentTotal}
        pageSize={recentPageSize}
        onPage={(p) => setRecentPage(p)}
        onPageSize={(s) => {
          setRecentPageSize(s)
          setRecentPage(1)
        }}
      />

      <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', marginTop: '0.8rem' }}>
        {note}
      </p>
    </Section>
  )
}