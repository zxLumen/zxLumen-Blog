import { REPORT_TOKEN, readJson, getDb } from '@/lib/db'
import { fetchUsage, getLastError, type UsageRange } from '@/lib/deepseek'

export const dynamic = 'force-dynamic'

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

const RANGES: UsageRange[] = ['24h', '7d', '30d', '90d']

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('range') || '30d'
  const range = (RANGES as string[]).includes(raw) ? (raw as UsageRange) : '30d'
  try {
    const data = await fetchUsage(range)
    return Response.json({
      source: 'deepseek',
      rows: data.rows,
      currency: data.currency,
      start: data.start,
      end: data.end,
    })
  } catch (e) {
    const code = (e as { code?: string }).code
    return Response.json({
      source: code === 'INVALID_TOKEN' ? 'invalid' : 'error',
      error: e instanceof Error ? e.message : String(e),
      lastError: getLastError(),
      rows: [],
    })
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
