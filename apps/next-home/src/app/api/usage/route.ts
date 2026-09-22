import type { UsageRow } from '@zx/shared'
import { REPORT_TOKEN, readJson } from '@/lib/db'
import { getActiveDb } from '@/lib/env'
import { fetchUsage, getLastError, getLastRows, type UsageRange } from '@/lib/deepseek'
import {
  fetchUsageOpenCode,
  filterUsageOpenCode,
  getLastData,
  getLastError as ocLastError,
} from '@/lib/opencode'
import { featureOn } from '@/lib/env'

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

const RANGES: UsageRange[] = ['today', 'yesterday', '7d', '30d', 'month', 'lastmonth', 'custom']

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
  const all = (await getActiveDb()).listUsage(days)
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

/** OpenCode 数据源:官方 Console 导出,今天/昨天按小时,其余按天 */
async function opencodeUsage(range: UsageRange, start?: string, end?: string) {
  const filter =
    range === 'custom'
      ? {
          start: start && isIsoDate(start) ? start : undefined,
          end: end && isIsoDate(end) ? end : undefined,
        }
      : undefined
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
    lastError?: string,
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
        ...(lastError ? { lastError } : {}),
      },
      { headers: noStore },
    )
  try {
    const d = await fetchUsageOpenCode(range, filter)
    return send(d, 'opencode', Date.now())
  } catch (e) {
    const code = (e as { code?: string }).code
    const error = e instanceof Error ? e.message : String(e)
    // 失败时回退上次成功快照(官方近 30 天小时级数据,可重新聚合到任意区间);
    // 未配置 key 不属于「失败」,如实返回 unconfigured
    const raw = code === 'UNCONFIGURED' ? '' : await getLastData()
    if (raw) {
      try {
        const snap = JSON.parse(raw) as { at?: number; rows?: UsageRow[] }
        if (Array.isArray(snap.rows) && snap.rows.length) {
          const d = filterUsageOpenCode(snap.rows, range, filter)
          return send(d, 'stale', snap.at ?? 0, error)
        }
      } catch {
        /* ignore */
      }
    }
    return Response.json(
      {
        source: code === 'UNCONFIGURED' ? 'unconfigured' : code === 'INVALID_KEY' ? 'invalid' : 'error',
        error,
        lastError: await ocLastError(),
        rows: [],
        models: [],
        apiKeys: [],
        granularity: range === 'today' || range === 'yesterday' ? 'hour' : 'day',
      },
      { headers: noStore },
    )
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const raw = url.searchParams.get('range') || '30d'
  const range = (RANGES as string[]).includes(raw) ? (raw as UsageRange) : '30d'
  const start = url.searchParams.get('start') || undefined
  const end = url.searchParams.get('end') || undefined

  const sourceParam = url.searchParams.get('source') || 'deepseek'
  if (sourceParam === 'opencode') {
    // OpenCode 数据源:功能门控,未放行时不返回
    if (!(await featureOn('usage-opencode'))) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    return opencodeUsage(range, start, end)
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
        granularity: data.granularity ?? (range === 'today' || range === 'yesterday' ? 'hour' : 'day'),
        start: data.start,
        end: data.end,
        at: Date.now(),
      },
      { headers: noStore },
    )
  } catch (e) {
    const code = (e as { code?: string }).code
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
          granularity: last.granularity ?? (range === 'today' || range === 'yesterday' ? 'hour' : 'day'),
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
        source: code === 'INVALID_TOKEN' ? 'invalid' : 'error',
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
  const row = (await getActiveDb()).addUsage({
    ts: data.ts,
    model: data.model,
    inputTokens: data.inputTokens ?? data.input_tokens ?? 0,
    outputTokens: data.outputTokens ?? data.output_tokens ?? 0,
    cacheHitTokens: data.cacheHitTokens ?? data.cache_hit_tokens ?? 0,
    source: data.source ?? 'report',
  })
  return Response.json({ ok: true, row }, { status: 201 })
}