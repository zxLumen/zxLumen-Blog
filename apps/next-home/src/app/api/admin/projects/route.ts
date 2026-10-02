import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getProjectsRev,
  getStoredProjects,
  saveStoredProjects,
  resetStoredProjects,
  StaleProjectsError,
} from '@/lib/projects-config'

export const dynamic = 'force-dynamic'

// admin 项目管理接口(整表覆盖模式):
//   GET    → { projects: 全部(含垃圾箱), rev }  数组顺序 = 展示顺序;rev 是乐观锁版本戳
//   POST   → { projects, rev? }  整表保存(新增/编辑/排序/软删除都走这里)
//            带 rev 时做乐观并发校验,不匹配 → 409(防止旧页面把别处新增的条目整表抹掉)
//   DELETE → 恢复为静态默认(删除配置)
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ projects: await getStoredProjects(), rev: getProjectsRev() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ projects?: unknown; rev?: string }>(req).catch(() => null)
  if (!body || !Array.isArray(body.projects)) {
    return Response.json({ error: '缺少 projects 数组' }, { status: 400 })
  }
  try {
    const projects = saveStoredProjects(body.projects, body.rev)
    return Response.json({ ok: true, projects, rev: getProjectsRev() })
  } catch (err) {
    if (err instanceof StaleProjectsError) {
      return Response.json({ error: err.message, stale: true, rev: err.currentRev }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const projects = await resetStoredProjects()
  return Response.json({ ok: true, projects })
}
