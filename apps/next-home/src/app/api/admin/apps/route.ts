import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { getStoredApps, resetStoredApps, saveStoredApps } from '@/lib/app-config'

export const dynamic = 'force-dynamic'

// admin 应用栏管理接口(整表覆盖模式,与 projects / vlog 一致):
//   GET    → { apps: 全部(含垃圾箱) }  数组顺序 = 展示顺序
//   POST   → { apps: StoredApp[] }  整表保存(新增/编辑/排序/软删除都走这里)
//   DELETE → 恢复为出厂默认(删除配置)
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ apps: getStoredApps() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ apps?: unknown }>(req).catch(() => null)
  if (!body || !Array.isArray(body.apps)) {
    return Response.json({ error: '缺少 apps 数组' }, { status: 400 })
  }
  const apps = saveStoredApps(body.apps)
  return Response.json({ ok: true, apps })
}

export async function DELETE() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const apps = resetStoredApps()
  return Response.json({ ok: true, apps })
}
