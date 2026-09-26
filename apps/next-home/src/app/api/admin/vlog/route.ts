import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  countTitled,
  enrichVlogMeta,
  getStoredVlogs,
  normalizeVlogList,
  resetStoredVlogs,
  writeStoredVlogs,
} from '@/lib/vlog-config'

export const dynamic = 'force-dynamic'

// admin 抖音短视频管理接口(整表覆盖模式):
//   GET    → { series: 全部(含垃圾箱) }  数组顺序 = 展示顺序
//   POST   → { series: StoredVlogSeries[] }  整表保存(新增/编辑/排序/软删除都走这里)
//            保存前对标题为空的条目自动按视频ID补全(失败不影响保存)
//   DELETE → 清空配置(恢复为空)
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ series: getStoredVlogs() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ series?: unknown }>(req).catch(() => null)
  if (!body || !Array.isArray(body.series)) {
    return Response.json({ error: '缺少 series 数组' }, { status: 400 })
  }
  const normalized = normalizeVlogList(body.series)
  const before = countTitled(normalized)
  const enriched = await enrichVlogMeta(normalized)
  const series = writeStoredVlogs(enriched)
  return Response.json({ ok: true, series, filled: countTitled(series) - before })
}

export async function DELETE() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const series = resetStoredVlogs()
  return Response.json({ ok: true, series })
}
