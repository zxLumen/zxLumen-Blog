import { isAdmin } from '@/lib/auth'
import { getActiveDb } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const page = Number(url.searchParams.get('page') || 1)
  const pageSize = Number(url.searchParams.get('pageSize') || 20)
  const db = await getActiveDb()
  const data = db.listThreadPage({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    includePrivate: true,
  })
  return Response.json(data)
}
