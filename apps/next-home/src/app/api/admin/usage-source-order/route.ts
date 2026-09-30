import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { getUsageSourceOrder, setUsageSourceOrder } from '@/lib/usage-source-order'

export const dynamic = 'force-dynamic'

// admin 数据源顺序接口:
//   GET  → { order: 当前展示顺序 }
//   POST → { order } 保存(规范化后写库),返回 { ok, order }
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ order: getUsageSourceOrder() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ order?: unknown }>(req).catch(() => null)
  if (!body || !Array.isArray(body.order)) {
    return Response.json({ error: '缺少 order 数组' }, { status: 400 })
  }
  const order = setUsageSourceOrder(body.order)
  return Response.json({ ok: true, order })
}