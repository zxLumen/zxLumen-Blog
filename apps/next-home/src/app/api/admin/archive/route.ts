import { isAdmin } from '@/lib/auth'
import { getActiveDb } from '@/lib/env'
import { readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 归档留言:查询列表 = GET;恢复 / 彻底删除 = POST { id, action: 'restore' | 'purge' } */
export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const page = Number(url.searchParams.get('page') || 1)
  const pageSize = Number(url.searchParams.get('pageSize') || 20)
  const db = await getActiveDb()
  const data = db.listArchived({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
  })
  const res = Response.json(data)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const data = (await readJson<{ id?: number; action?: string }>(req)) ?? {}
  const id = typeof data?.id === 'number' ? data.id : null
  if (id === null) return Response.json({ error: 'id required' }, { status: 400 })
  const db = await getActiveDb()
  if (data.action === 'restore') {
    return Response.json({ ok: db.restoreComment(id) })
  }
  if (data.action === 'purge') {
    return Response.json({ ok: db.purgeComment(id) })
  }
  return Response.json({ error: 'action required' }, { status: 400 })
}