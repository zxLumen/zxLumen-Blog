// 拉取 provider 可用模型列表(供 admin 面板下拉选择,免手填模型名)。
// openai 兼容 → GET {base}/models(Bearer key);ollama → GET {base}/api/tags。
import { getChatApiKey, getConfig, getEmbedApiKey } from './config'
import { filterByPurpose, protocolOf } from './providers'

export interface ModelListResult {
  models: string[]
  provider: string
  baseUrl: string
  protocol: 'openai' | 'ollama'
}

function ensureUrl(base: string): string {
  return base.replace(/\/+$/, '')
}

function extractOpenAiIds(j: unknown): string[] {
  const o = j as { data?: Array<{ id?: string } | string>; models?: Array<{ id?: string } | string> }
  const raw = o?.data ?? o?.models ?? []
  return raw
    .map((m) => (typeof m === 'string' ? m : m?.id || ''))
    .filter((s): s is string => !!s)
}

/**
 * 列出某类用途(chat/embedding)可用模型。
 * provider/baseUrl 缺省取已保存配置;可传覆盖值(用于面板未保存时的预览)。
 */
export async function listModels(
  kind: 'chat' | 'embed',
  overrides: { provider?: string; baseUrl?: string } = {},
): Promise<ModelListResult> {
  const cfg = getConfig()
  const provider = overrides.provider || (kind === 'chat' ? cfg.chatProvider : cfg.embedProvider)
  const baseUrl = (overrides.baseUrl || (kind === 'chat' ? cfg.chatBaseUrl : cfg.embedBaseUrl) || '').trim()
  const protocol = protocolOf(provider)
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('未配置 baseUrl')
  const key = kind === 'chat' ? getChatApiKey() : getEmbedApiKey()
  if (protocol !== 'ollama' && !key) throw new Error('未配置 API Key(先填 Key 并保存)')

  let ids: string[] = []
  if (protocol === 'ollama') {
    const res = await fetch(`${ensureUrl(baseUrl)}/api/tags`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
    const j = (await res.json()) as { models?: Array<{ name?: string }> }
    ids = (j.models ?? []).map((m) => m.name || '').filter(Boolean)
  } else {
    const res = await fetch(`${ensureUrl(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`模型列表 HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    ids = extractOpenAiIds(await res.json())
  }

  const filtered = filterByPurpose(ids, kind === 'chat' ? 'chat' : 'embedding')
  const models = (filtered.length ? filtered : ids).sort((a, b) => a.localeCompare(b))
  return { models, provider, baseUrl, protocol }
}
