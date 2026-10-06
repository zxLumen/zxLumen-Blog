import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getGatewayStatus,
  saveGatewayConfig,
  resetAppUsage,
  GATEWAY_META_KEY,
} from '@/lib/ai-gateway'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json(getGatewayStatus())
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ action?: string; appId?: string; config?: unknown }>(req)
  if (!body) return Response.json({ error: '请求体非法' }, { status: 400 })

  if (body.action === 'reset-usage') {
    if (!body.appId) return Response.json({ error: '缺少 appId' }, { status: 400 })
    resetAppUsage(body.appId)
    return Response.json({ ok: true, ...getGatewayStatus() })
  }

  if (!body.config || typeof body.config !== 'object') {
    return Response.json({ error: '缺少 config' }, { status: 400 })
  }
  saveGatewayConfig(body.config)
  return Response.json({ ok: true, ...getGatewayStatus() })
}

export async function DELETE() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { getDb } = await import('@/lib/db')
  getDb().delMeta(GATEWAY_META_KEY)
  return Response.json({ ok: true, ...getGatewayStatus() })
}
