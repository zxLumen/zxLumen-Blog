import { isAdmin } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const data = await readJson<{ id?: number }>(req)
  if (typeof data?.id !== 'number') {
    return Response.json({ error: 'id required' }, { status: 400 })
  }
  const db = await getDb()
  return Response.json({ ok: db.archiveComment(data.id, 'admin') })
}
