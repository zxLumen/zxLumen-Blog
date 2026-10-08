import { randomUUID } from 'node:crypto'
import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { getGatewayConfig, type ProviderApi } from '@/lib/ai-gateway'

export const dynamic = 'force-dynamic'

function extractIds(j: unknown): string[] {
  const o = j as { data?: unknown[]; models?: unknown[] }
  const arr = Array.isArray(o?.data) ? o.data : Array.isArray(o?.models) ? o.models : []
  const ids = arr
    .map((m) => {
      if (typeof m === 'string') return m
      const r = m as { id?: unknown; name?: unknown }
      return typeof r?.id === 'string' ? r.id : typeof r?.name === 'string' ? r.name : ''
    })
    .filter((x): x is string => !!x)
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b))
}

/** Deepgram 常用 STT 模型(优先展示;命不中就回退全量去重) */
const DEEPGRAM_PREFERRED = [
  'nova-3',
  'nova-3-general',
  'nova-2',
  'nova-2-general',
  'nova-2-phonecall',
  'nova-2-meeting',
  'enhanced',
  'enhanced-general',
  'enhanced-phonecall',
  'enhanced-meeting',
  'base',
  'base-general',
  'whisper-large',
  'whisper-medium',
  'whisper-small',
  'whisper-base',
  'whisper-tiny',
]

/** Deepgram /v1/models → { stt:[{ name, canonical_name }], tts:[...] }(多条可共用同一 canonical_name → 去重) */
function extractDeepgram(j: unknown): string[] {
  const o = j as { stt?: unknown[] }
  const arr = Array.isArray(o?.stt) ? o.stt : []
  const ids = arr
    .map((m) => {
      if (typeof m === 'string') return m
      const r = m as { canonical_name?: unknown; name?: unknown }
      return typeof r?.canonical_name === 'string'
        ? r.canonical_name
        : typeof r?.name === 'string'
          ? r.name
          : ''
    })
    .filter((x): x is string => !!x)
  const uniq = Array.from(new Set(ids))
  const hit = DEEPGRAM_PREFERRED.filter((m) => uniq.includes(m))
  return hit.length ? hit : uniq.sort((a, b) => a.localeCompare(b))
}

/** 无公开模型列表接口的上游:返回常用静态列表(仍可手填) */
const STATIC_MODELS: Partial<Record<ProviderApi, string[]>> = {
  assemblyai: ['best', 'nano', 'slam-1'],
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ providerId?: string; baseUrl?: string; apiKey?: string }>(req)
  if (!body) return Response.json({ error: '请求体非法' }, { status: 400 })

  let baseUrl = (body.baseUrl ?? '').trim().replace(/\/+$/, '')
  let apiKey = (body.apiKey ?? '').trim()
  let api: ProviderApi = 'openai'
  if (body.providerId) {
    const p = getGatewayConfig().providers.find((x) => x.id === body.providerId)
    if (!p) return Response.json({ error: '未找到该密钥' }, { status: 404 })
    if (!baseUrl) baseUrl = p.baseUrl
    if (!apiKey) apiKey = p.apiKey
    api = p.api
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return Response.json({ error: 'baseUrl 非法(需 http(s)://)' }, { status: 400 })
  }

  const staticList = STATIC_MODELS[api]
  if (staticList) return Response.json({ models: [...staticList].sort((a, b) => a.localeCompare(b)) })

  const headers: Record<string, string> = {}
  if (apiKey) {
    // Deepgram 用 `Token`,其余用 `Bearer`
    headers.Authorization = api === 'deepgram' ? `Token ${apiKey}` : `Bearer ${apiKey}`
  }
  if (/opencode\.ai\/zen\/go/.test(baseUrl)) {
    headers['x-opencode-session'] = randomUUID()
    headers['User-Agent'] = 'zx-ai-gateway/1.0'
  }

  const url = api === 'deepgram' ? `${baseUrl}/v1/models` : `${baseUrl}/models`
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return Response.json(
        { error: `上游 ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}` },
        { status: 400 },
      )
    }
    const json = await res.json()
    return Response.json({ models: api === 'deepgram' ? extractDeepgram(json) : extractIds(json) })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : '拉取失败' }, { status: 400 })
  }
}
