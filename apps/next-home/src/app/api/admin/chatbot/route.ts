import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  clearChatApiKey,
  clearEmbedApiKey,
  getBotStatus,
  GATEWAY_ENTRY,
  saveConfig,
  setChatApiKey,
  setEmbedApiKey,
  type ChatBotConfig,
} from '@/lib/chat/config'
import { listEmbeddingPresets, listProviders } from '@/lib/chat/providers'
import { getGatewayConfig, newToken, saveGatewayConfig } from '@/lib/ai-gateway'

export const dynamic = 'force-dynamic'

/** GET:完整配置 + 掩码密钥 + provider 列表(仅管理员可见) */
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const status = getBotStatus()
  const withGw = (list: ReturnType<typeof listProviders>) =>
    list.map((p) => (p.id === 'zx-gateway' ? { ...p, baseUrl: GATEWAY_ENTRY } : p))
  return Response.json({
    ...status,
    providers: withGw(listProviders()),
    embeddingProviders: withGw(listEmbeddingPresets()),
  })
}

interface SaveBody extends Partial<ChatBotConfig> {
  chatApiKey?: string
  embedApiKey?: string
  action?: string
}

/** POST:保存配置;空字符串/显示掩码 = 不改,`__CLEAR__` = 清空 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<SaveBody>(req)
  if (!body) return Response.json({ error: '请求体无效' }, { status: 400 })

  // 为「博客机器人」创建/复用一个接入令牌(在「AI 密钥」页可见并统计用量)
  if (body.action === 'create-token') {
    const gw = getGatewayConfig()
    let app = gw.apps.find((a) => a.id === 'blog-bot')
    if (!app) {
      app = {
        id: 'blog-bot',
        name: '博客机器人',
        token: newToken(),
        enabled: true,
        providerId: '',
        model: '',
        dailyLimit: 0,
        totalLimit: 0,
        audioLimit: 0,
        note: '博客自身(聊天/问候/蒸馏/RAG)',
      }
      gw.apps.push(app)
      saveGatewayConfig(gw)
    }
    return Response.json({ ok: true, token: app.token })
  }

  const keys = ['chatApiKey', 'embedApiKey'] as const
  for (const k of keys) {
    const v = (body as Record<string, unknown>)[k]
    if (typeof v !== 'string' || v === '') continue
    // 显示掩码(如 ••••xxxx / ****)不是真实密钥,忽略,避免把掩码写库
    if (/^[•*]/.test(v)) continue
    if (v === '__CLEAR__') {
      if (k === 'chatApiKey') clearChatApiKey()
      else clearEmbedApiKey()
    } else {
      if (k === 'chatApiKey') setChatApiKey(v)
      else setEmbedApiKey(v)
    }
  }

  const cfg: Record<string, unknown> = { ...body }
  delete cfg.chatApiKey
  delete cfg.embedApiKey
  const config = saveConfig(cfg)
  return Response.json({ ok: true, config, status: getBotStatus() })
}