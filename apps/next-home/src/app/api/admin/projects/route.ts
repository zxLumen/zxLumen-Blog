import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getStoredProjects,
  saveStoredProjects,
  resetStoredProjects,
} from '@/lib/projects-config'

export const dynamic = 'force-dynamic'

// admin 项目管理接口(整表覆盖模式):
//   GET    → { projects: 全部(含垃圾箱) }  数组顺序 = 展示顺序
//   POST   → { projects: StoredProject[] }  整表保存(新增/编辑/排序/软删除都走这里)
//   DELETE → 恢复为静态默认(删除配置)
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ projects: await getStoredProjects() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ projects?: unknown }>(req).catch(() => null)
  if (!body || !Array.isArray(body.projects)) {
    return Response.json({ error: '缺少 projects 数组' }, { status: 400 })
  }
  const projects = saveStoredProjects(body.projects)
  return Response.json({ ok: true, projects })
}

export async function DELETE() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const projects = await resetStoredProjects()
  return Response.json({ ok: true, projects })
}
