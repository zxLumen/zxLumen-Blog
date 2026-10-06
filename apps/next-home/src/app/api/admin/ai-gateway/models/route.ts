import { randomUUID } from 'node:crypto'
import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { getGatewayConfig } from '@/lib/ai-gateway'

export const dynamic = 'force-dynamic'

function extractIds(j: unknown): string[] {
  const o = j as { data?: unknown[]; models?: unknown[] }
  const arr = Array.isArray(o?.data) ? o.data : Array.isArray(o?.models) ? o.models : []
  return arr
    .map((m) => {
      if (typeof m === 'string') return m
      const r = m as { id?: unknown; name?: unknown }
      return typeof r?.id === 'string' ? r.id : typeof r?.name === 'string' ? r.name : ''
    })
    .filter((x): x is string => !!x)
    .sort((a, b) => a.localeCompare(b))
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ providerId?: string; baseUrl?: string; apiKey?: string }>(req)
  if (!body) return Response.json({ error: '请求体非法' }, { status: 400 })

  let baseUrl = (body.baseUrl ?? '').trim().replace(/\/+$/, '')
  let apiKey = (body.apiKey ?? '').trim()
  if (body.providerId) {
    const p = getGatewayConfig().providers.find((x) => x.id === body.providerId)
    if (!p) return Response.json({ error: '未找到该密钥' }, { status: 404 })
    if (!baseUrl) baseUrl = p.baseUrl
    if (!apiKey) apiKey = p.apiKey
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    return Response.json({ error: 'baseUrl 非法(需 http(s):// 且含 /v1 之类前缀)' }, { status: 400 })
  }

  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (/opencode\.ai\/zen\/go/.test(baseUrl)) {
    headers['x-opencode-session'] = randomUUID()
    headers['User-Agent'] = 'zx-ai-gateway/1.0'
  }

  try {
    const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return Response.json(
        { error: `上游 ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}` },
        { status: 400 },
      )
    }
    return Response.json({ models: extractIds(await res.json()) })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : '拉取失败' },
      { status: 400 },
    )
  }
}
