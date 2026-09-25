import { isAdmin } from '@/lib/auth'
import { listModels } from '@/lib/chat/models'

export const dynamic = 'force-dynamic'

/**
 * GET:按 provider 拉取可用模型列表(admin 面板下拉用)。
 * ?kind=chat|embed&provider=<id>&baseUrl=<url>(provider/baseUrl 可省略,缺省用已保存配置)
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams
  const kind = sp.get('kind') === 'embed' ? 'embed' : 'chat'
  try {
    const r = await listModels(kind, {
      provider: sp.get('provider') || undefined,
      baseUrl: sp.get('baseUrl') || undefined,
    })
    return Response.json({ ok: true, kind, ...r })
  } catch (e) {
    return Response.json(
      { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) },
      { status: 400 },
    )
  }
}
