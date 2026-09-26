import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { fetchDouyinMeta } from '@/lib/vlog-config'

export const dynamic = 'force-dynamic'

// 单条抖音信息刷新(后台「↻」按钮):
//   POST { vid } → { title, w, h }
// title 实为「作品描述」(已去 #话题/@提及);w/h 用于自动判断横竖屏。
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ vid?: unknown }>(req).catch(() => null)
  const vid = typeof body?.vid === 'string' ? body.vid.trim() : ''
  if (!vid) return Response.json({ error: '缺少 vid' }, { status: 400 })
  const meta = await fetchDouyinMeta(vid)
  return Response.json({ ok: true, ...meta })
}
