import { randomUUID } from 'node:crypto'
import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getGatewayConfig,
  type GatewayProvider,
  type ProviderApi,
  type ProviderRole,
} from '@/lib/ai-gateway'

export const dynamic = 'force-dynamic'

/** 单个上游探测超时(毫秒) */
const TIMEOUT = 20_000

interface TestResult {
  id: string
  name: string
  role: ProviderRole
  ok: boolean
  ms: number
  status?: number
  endpoint?: string
  error?: string
}

interface TestBody {
  providerId?: string
  name?: string
  baseUrl?: string
  apiKey?: string
  role?: ProviderRole
  api?: ProviderApi
  model?: string
}

/** 上游鉴权头(与 models 路由一致):Bearer / Deepgram Token / OpenCode Go 补会话头 */
function buildHeaders(p: GatewayProvider): Record<string, string> {
  const h: Record<string, string> = {}
  if (p.apiKey) h.Authorization = p.api === 'deepgram' ? `Token ${p.apiKey}` : `Bearer ${p.apiKey}`
  if (/opencode\.ai\/zen\/go/.test(p.baseUrl)) {
    h['x-opencode-session'] = randomUUID()
    h['User-Agent'] = 'zx-ai-gateway/1.0'
  }
  return h
}

function isEmbedRole(role: ProviderRole): boolean {
  return role === 'embed'
}

/** /models 返回体里提取模型 id(兼容 data[] 与 models[]) */
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
}

/** 对话/向量测试所需的模型名:密钥默认 → 已拉取列表首个 → 现场拉 /models 兜底 */
async function resolveModel(p: GatewayProvider): Promise<string> {
  if (p.model) return p.model
  if (p.models[0]) return p.models[0]
  try {
    const url = p.api === 'deepgram' ? `${p.baseUrl}/v1/models` : `${p.baseUrl}/models`
    const res = await fetch(url, { headers: buildHeaders(p), signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const ids = extractIds(await res.json())
      if (ids[0]) return ids[0]
    }
  } catch {
    /* 兜底失败则由调用方报「未配置模型」 */
  }
  return ''
}

async function probe(p: GatewayProvider): Promise<TestResult> {
  const t0 = Date.now()
  const done = (ok: boolean, extra: Partial<TestResult> = {}): TestResult => ({
    id: p.id,
    name: p.name,
    role: p.role,
    ok,
    ms: Date.now() - t0,
    ...extra,
  })

  if (!/^https?:\/\//i.test(p.baseUrl)) {
    return done(false, { error: 'baseUrl 非法(需 http(s)://)' })
  }
  const headers = buildHeaders(p)

  try {
    // 音频:无音频文件可用,改用带鉴权的轻量接口校验 key + 可达性
    if (p.role === 'audio') {
      const [endpoint, url] =
        p.api === 'deepgram'
          ? ['v1/models', `${p.baseUrl}/v1/models`]
          : p.api === 'assemblyai'
            ? ['v2/transcript', `${p.baseUrl}/v2/transcript?limit=1`]
            : ['models', `${p.baseUrl}/models`]
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) })
      if (!res.ok) {
        const t = (await res.text().catch(() => '')).slice(0, 200)
        return done(false, { status: res.status, endpoint, error: `上游 ${res.status}${t ? `: ${t}` : ''}` })
      }
      await res.arrayBuffer().catch(() => {})
      return done(true, { status: res.status, endpoint })
    }

    const model = await resolveModel(p)
    if (!model) {
      return done(false, { error: '未配置模型(请先在密钥里选默认模型或拉取模型)' })
    }
    const embed = isEmbedRole(p.role)
    const endpoint = embed ? 'embeddings' : 'chat/completions'
    const payload = embed
      ? { model, input: 'ping' }
      : { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }
    const res = await fetch(`${p.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 200)
      return done(false, { status: res.status, endpoint, error: `上游 ${res.status}${t ? `: ${t}` : ''}` })
    }
    await res.arrayBuffer().catch(() => {})
    return done(true, { status: res.status, endpoint })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '请求失败'
    return done(false, { error: /abort/i.test(msg) ? '请求超时' : msg })
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await readJson<TestBody>(req)) ?? {}

  const saved = getGatewayConfig().providers
  const canAdHoc = !!(body.providerId || body.baseUrl)

  let targets: GatewayProvider[]
  if (canAdHoc) {
    const s = body.providerId ? saved.find((x) => x.id === body.providerId) : undefined
    targets = [
      {
        id: body.providerId || 'ad-hoc',
        name: body.name || s?.name || body.providerId || '新密钥',
        baseUrl: (body.baseUrl || s?.baseUrl || '').trim().replace(/\/+$/, ''),
        apiKey: (body.apiKey || s?.apiKey || '').trim(),
        model: body.model ?? s?.model ?? '',
        models: s?.models ?? [],
        enabled: true,
        role: body.role || s?.role || 'chat',
        api: body.api || s?.api || 'openai',
      },
    ]
  } else {
    targets = saved.filter((p) => p.enabled)
  }

  const results = await Promise.all(targets.map(probe))
  return Response.json({ results })
}
