import { isAdmin } from '@/lib/auth'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 管理端统计聚合(留言/简历/项目点击/访客/访客明细) */
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const stats = (await getDb()).stats({ visitors: true })
  const res = Response.json(stats)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
