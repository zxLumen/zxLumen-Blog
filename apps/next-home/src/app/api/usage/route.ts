import type { UsageRow } from '@zx/shared'
import { REPORT_TOKEN, readJson, getDb } from '@/lib/db'
import { fetchUsage, getLastError, getLastRows, type UsageRange } from '@/lib/deepseek'

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
function localUsage(range: UsageRange, start?: string, end?: string): { rows: UsageRow[] } {
  let days = RANGE_DAYS[range]
  if (range === 'custom' && start && end) {
    const diff = (new Date(end).getTime() - new Date(start).getTime()) / 86400000
    if (Number.isFinite(diff) && diff >= 0 && diff <= 366) days = Math.floor(diff) + 1
  }
  const all = getDb().listUsage(days)
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

export async function GET(req: Request) {
  const url = new URL(req.url)
  const raw = url.searchParams.get('range') || '30d'
  const range = (RANGES as string[]).includes(raw) ? (raw as UsageRange) : '30d'
  const start = url.searchParams.get('start') || undefined
  const end = url.searchParams.get('end') || undefined
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
    const last = getLastRows(range)
    if (last) {
      return Response.json(
        {
          source: 'stale',
          rows: last.rows,
          models: last.models ?? Array.from(new Set(last.rows.map((r) => r.model))),
          apiKeys: last.apiKeys ?? [],
          currency: last.currency,
          at: last.at,
          lastError: error,
        },
        { headers: noStore },
      )
    }
    // 2) 回退本地 usage 表(上报数据,按 range 聚合)
    const local = localUsage(range, start, end)
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
        lastError: getLastError(),
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
  const row = getDb().addUsage({
    ts: data.ts,
    model: data.model,
    inputTokens: data.inputTokens ?? data.input_tokens ?? 0,
    outputTokens: data.outputTokens ?? data.output_tokens ?? 0,
    cacheHitTokens: data.cacheHitTokens ?? data.cache_hit_tokens ?? 0,
    source: data.source ?? 'report',
  })
  return Response.json({ ok: true, row }, { status: 201 })
}