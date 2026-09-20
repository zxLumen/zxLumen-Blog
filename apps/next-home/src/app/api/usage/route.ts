import { getDb, REPORT_TOKEN, readJson } from '@/lib/db'
import { getActiveDb } from '@/lib/env'

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

export async function GET(req: Request) {
  const days = Number(new URL(req.url).searchParams.get('days') || 30)
  const db = await getActiveDb()
  return Response.json({ rows: db.listUsage(Number.isFinite(days) ? days : 30) })
}

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
