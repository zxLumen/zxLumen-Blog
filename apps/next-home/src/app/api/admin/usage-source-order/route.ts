import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getUsageSourceOrder,
  setUsageSourceOrder,
  getUsageDefaultSource,
  setUsageDefaultSource,
} from '@/lib/usage-source-order'

export const dynamic = 'force-dynamic'

// admin 数据源接口:
//   GET  → { order: 当前展示顺序, defaultSource: 默认数据源 }
//   POST → { order, defaultSource? } 保存(规范化后写库),返回 { ok, order, defaultSource }
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ order: getUsageSourceOrder(), defaultSource: getUsageDefaultSource() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ order?: unknown; defaultSource?: unknown }>(req).catch(() => null)
  if (!body || !Array.isArray(body.order)) {
    return Response.json({ error: '缺少 order 数组' }, { status: 400 })
  }
  const order = setUsageSourceOrder(body.order)
  // defaultSource 缺省表示不动(避免误清);提供则写入(非法值由 setter 规范化)
  const defaultSource =
    body.defaultSource === undefined ? getUsageDefaultSource() : setUsageDefaultSource(body.defaultSource)
  return Response.json({ ok: true, order, defaultSource })
}
