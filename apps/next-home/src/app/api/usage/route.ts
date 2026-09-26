import { RANGES, type UsageRow } from '@zx/shared'
import { granularityOf } from '@/lib/usage/range'
import { codeToSource, errorCode } from '@/lib/usage/errors'
import { REPORT_TOKEN, readJson } from '@/lib/db'
import { getDb } from '@/lib/db'
import { fetchUsage, getLastError, getLastRows, type UsageRange } from '@/lib/deepseek'
import {
  fetchUsageOpenCodeWs,
  filterUsageOpenCode,
  mergeUsageOpenCode,
  fetchGoQuotaWs,
  getWorkspaces,
  getLastData,
  getAnySnapshot,
  getHourlyRows,
  ensureHourlyScheduler,
  getLastError as ocLastError,
  type GoQuota,
  type OcWorkspace,
  type PlatformUsageOpenCode,
} from '@/lib/opencode'
import {
  fetchUsageZhipu,
  fetchZhipuQuota,
  getLastRows as zhipuLastRows,
  getLastError as zhipuLastError,
} from '@/lib/zhipu'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

interface UsageBody {
  ts?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_hit_tokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheHitTokens?: number
  source?: string
}

/** 本地回退按「天」聚合所需的窗口长度 */
const RANGE_DAYS: Record<UsageRange, number> = {
  today: 1,
  yesterday: 1,
  '7d': 7,
  '30d': 30,
  month: 31,
  lastmonth: 31,
  custom: 31,
}

/** 本地 usage 表按 (天 × 模型) 聚合,requests = 上报次数(成本由前端按价目估算) */
async function localUsage(range: UsageRange, start?: string, end?: string): Promise<{ rows: UsageRow[] }> {
  let days = RANGE_DAYS[range]
  if (range === 'custom' && start && end) {
    const diff = (new Date(end).getTime() - new Date(start).getTime()) / 86400000
    if (Number.isFinite(diff) && diff >= 0 && diff <= 366) days = Math.floor(diff) + 1
  }
  const all = (await getDb()).listUsage(days)
  const map = new Map<string, UsageRow>()
  for (const r of all) {
    const key = `${r.ts.slice(0, 10)}|${r.model}`
    const ex = map.get(key)
    if (ex) {
      ex.inputTokens += r.inputTokens
      ex.outputTokens += r.outputTokens
      ex.cacheHitTokens += r.cacheHitTokens
      ex.requests = (ex.requests ?? 0) + 1
    } else {
      map.set(key, {
        ts: `${r.ts.slice(0, 10)}T00:00:00Z`,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheHitTokens: r.cacheHitTokens,
        requests: 1,
        source: 'local',
      })
    }
  }
  return { rows: [...map.values()] }
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** OpenCode 数据源:官方 Console 导出,多 workspace 合并;今天/昨天按小时,其余按天 */
async function opencodeUsage(range: UsageRange, start?: string, end?: string, wsParam?: string) {
  // 启动自建小时采样(仅注册一次;不影响本次请求)
  ensureHourlyScheduler()

  const filter =
    range === 'custom'
      ? {
          start: start && isIsoDate(start) ? start : undefined,
          end: end && isIsoDate(end) ? end : undefined,
        }
      : undefined

  const all = await getWorkspaces()
  const wanted = (wsParam ?? '').trim()
  const selected =
    !wanted || wanted === 'all'
      ? all
      : all.filter((w) => wanted.split(',').map((s) => s.trim()).includes(w.id))

  const send = (
    d: {
      rows: UsageRow[]
      models: string[]
      providers: string[]
      currency: string
      granularity: 'hour' | 'day'
      start: string
      end: string
      platformLimit: boolean
    },
    source: string,
    at: number,
    opts?: { lastError?: string; goQuotas?: { name: string; quota: GoQuota | null }[] },
  ) =>
    Response.json(
      {
        source,
        rows: d.rows,
        models: d.models,
        apiKeys: d.providers,
        currency: d.currency,
        granularity: d.granularity,
        platformLimit: d.platformLimit,
        start: d.start,
        end: d.end,
        at,
        workspaces: all.map((w) => ({ id: w.id, name: w.name })),
        ...(opts?.goQuotas ? { goQuotas: opts.goQuotas } : {}),
        ...(opts?.lastError ? { lastError: opts.lastError } : {}),
      },
      { headers: noStore },
    )

  if (selected.length === 0) {
    return Response.json(
      {
        source: 'unconfigured',
        error: all.length === 0 ? '未配置 workspace' : '所选 workspace 不存在',
        lastError: await ocLastError(),
        rows: [],
        models: [],
        apiKeys: [],
        workspaces: all.map((w) => ({ id: w.id, name: w.name })),
        granularity: granularityOf(range),
      },
      { headers: noStore },
    )
  }

  const [parts, quotas] = await Promise.all([
    Promise.all(
      selected.map(async (ws) => {
        try {
          return { ws, data: await fetchUsageOpenCodeWs(ws, range, filter), ok: true as const }
        } catch (e) {
          return { ws, err: e as unknown, ok: false as const }
        }
      }),
    ),
    Promise.all(selected.map(async (ws) => ({ name: ws.name, quota: await fetchGoQuotaWs(ws) }))),
  ])

  const goQuotas = quotas.filter((q) => q.quota)
  const live = parts.filter((p): p is Extract<typeof p, { ok: true }> => p.ok)

  if (live.length > 0) {
    const merged = mergeUsageOpenCode(live.map((p) => ({ ws: p.ws, data: p.data })))
    const errs = parts
      .filter((p): p is Extract<typeof p, { ok: false }> => !p.ok)
      .map((p) => `${p.ws.name}: ${p.err instanceof Error ? p.err.message : String(p.err)}`)
    return send(
      merged,
      live.length === selected.length ? 'opencode' : 'stale',
      Date.now(),
      { lastError: errs.length ? errs.join('; ') : undefined, goQuotas: goQuotas.length ? goQuotas : undefined },
    )
  }

  // 全部失败:回退各 ws 快照
  const wantHour = range === 'today' || range === 'yesterday'
  const snaps: Array<{ ws: OcWorkspace; data: PlatformUsageOpenCode }> = []
  for (const ws of selected) {
    const raw = await getLastData(ws.id)
    if (!raw) continue
    try {
      const snap = JSON.parse(raw) as { rows?: UsageRow[]; grain?: 'hour' | 'day' }
      if (Array.isArray(snap.rows) && snap.rows.length) {
        const hourly = wantHour ? await getHourlyRows(ws.id) : undefined
        snaps.push({ ws, data: filterUsageOpenCode(snap.rows, range, filter, { grain: snap.grain, hourly }) })
      }
    } catch {
      /* ignore */
    }
  }
  // 当前 workspace 一个快照都没有(列表被改过 / 换过 id):回落到任意 ws 的上次成功快照
  let orphanNote = ''
  if (snaps.length === 0) {
    const any = await getAnySnapshot()
    if (any) {
      const ws = selected[0] ?? all[0]
      const hourly = wantHour ? await getHourlyRows(ws.id) : undefined
      snaps.push({ ws, data: filterUsageOpenCode(any.rows, range, filter, { grain: any.grain, hourly }) })
      orphanNote = '(显示的是其它 workspace 的上次成功快照)'
    }
  }
  if (snaps.length > 0) {
    const merged = mergeUsageOpenCode(snaps)
    const first = parts.find((p) => !p.ok) as Extract<(typeof parts)[number], { ok: false }> | undefined
    const error = first ? (first.err instanceof Error ? first.err.message : String(first.err)) : '拉取失败'
    return send(merged, 'stale', Date.now(), {
      lastError: error + orphanNote,
      goQuotas: goQuotas.length ? goQuotas : undefined,
    })
  }

  const first = parts.find((p) => !p.ok) as Extract<(typeof parts)[number], { ok: false }> | undefined
  const code = first ? errorCode(first.err) : undefined
  const error = first ? (first.err instanceof Error ? first.err.message : String(first.err)) : '拉取失败'
  return Response.json(
    {
      source: codeToSource(code),
      error,
      lastError: await ocLastError(),
      rows: [],
      models: [],
      apiKeys: [],
      workspaces: all.map((w) => ({ id: w.id, name: w.name })),
      granularity: granularityOf(range),
      ...(goQuotas.length ? { goQuotas } : {}),
    },
    { headers: noStore },
  )
}

/** 智谱数据源:monitor API 按模型 token 总量 + 配额;失败回退上次快照 */
async function zhipuUsage(range: UsageRange, start?: string, end?: string) {
  const filter =
    range === 'custom'
      ? {
          start: start && isIsoDate(start) ? start : undefined,
          end: end && isIsoDate(end) ? end : undefined,
        }
      : undefined
  try {
    const [d, quota] = await Promise.all([fetchUsageZhipu(range, filter), fetchZhipuQuota()])
    return Response.json(
      {
        source: 'zhipu',
        rows: d.rows,
        models: d.models,
        apiKeys: [],
        currency: d.currency,
        granularity: d.granularity,
        start: d.start,
        end: d.end,
        at: Date.now(),
        ...(quota ? { zhipuQuota: quota } : {}),
      },
      { headers: noStore },
    )
  } catch (e) {
    const code = errorCode(e)
    const error = e instanceof Error ? e.message : String(e)
    const last = code === 'UNCONFIGURED' ? null : await zhipuLastRows()
    if (last) {
      return Response.json(
        {
          source: 'stale',
          rows: last.rows,
          models: last.models,
          apiKeys: [],
          currency: 'CNY',
          granularity: 'day',
          at: last.at,
          lastError: error,
        },
        { headers: noStore },
      )
    }
    return Response.json(
      {
        source: codeToSource(code),
        error,
        lastError: await zhipuLastError(),
        rows: [],
        models: [],
        apiKeys: [],
        granularity: 'day',
      },
      { headers: noStore },
    )
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const raw = url.searchParams.get('range') || '30d'
  const range = (RANGES as readonly string[]).includes(raw) ? (raw as UsageRange) : '30d'
  const start = url.searchParams.get('start') || undefined
  const end = url.searchParams.get('end') || undefined

  const sourceParam = url.searchParams.get('source') || 'deepseek'
  if (sourceParam === 'opencode') {
    return opencodeUsage(range, start, end, url.searchParams.get('ws') || undefined)
  }
  if (sourceParam === 'zhipu') {
    return zhipuUsage(range, start, end)
  }

  const filter =
    range === 'custom'
      ? {
          start: start && isIsoDate(start) ? start : undefined,
          end: end && isIsoDate(end) ? end : undefined,
        }
      : undefined
  try {
    const data = await fetchUsage(range, filter)
    return Response.json(
      {
        source: 'deepseek',
        rows: data.rows,
        models: data.models,
        apiKeys: data.apiKeys,
        currency: data.currency,
        granularity: data.granularity ?? granularityOf(range),
        start: data.start,
        end: data.end,
        at: Date.now(),
      },
      { headers: noStore },
    )
  } catch (e) {
    const code = errorCode(e)
    const error = e instanceof Error ? e.message : String(e)
    // 1) 回退上次成功拉取的同 range 数据
    const last = await getLastRows(range)
    if (last) {
      return Response.json(
        {
          source: 'stale',
          rows: last.rows,
          models: last.models ?? Array.from(new Set(last.rows.map((r) => r.model))),
          apiKeys: last.apiKeys ?? [],
          currency: last.currency,
          granularity: last.granularity ?? granularityOf(range),
          at: last.at,
          lastError: error,
        },
        { headers: noStore },
      )
    }
    // 2) 回退本地 usage 表(上报数据,按 range 聚合)
    const local = await localUsage(range, start, end)
    if (local.rows.length > 0) {
      return Response.json(
        {
          source: 'local',
          rows: local.rows,
          models: Array.from(new Set(local.rows.map((r) => r.model))),
          apiKeys: [],
          at: Date.now(),
          lastError: error,
        },
        { headers: noStore },
      )
    }
    // 3) 无任何真实数据
    return Response.json(
      {
        source: codeToSource(code),
        error,
        lastError: await getLastError(),
        rows: [],
        models: [],
        apiKeys: [],
      },
      { headers: noStore },
    )
  }
}

// 兼容:仍支持自建服务上报(写入本地 usage 表)
export async function POST(req: Request) {
  const token = req.headers.get('x-report-token')
  if (token !== REPORT_TOKEN) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const data = await readJson<UsageBody>(req)
  if (!data?.model) return Response.json({ error: 'model required' }, { status: 400 })
  const row = (await getDb()).addUsage({
    ts: data.ts,
    model: data.model,
    inputTokens: data.inputTokens ?? data.input_tokens ?? 0,
    outputTokens: data.outputTokens ?? data.output_tokens ?? 0,
    cacheHitTokens: data.cacheHitTokens ?? data.cache_hit_tokens ?? 0,
    source: data.source ?? 'report',
  })
  return Response.json({ ok: true, row }, { status: 201 })
}