import { isAdmin } from '@/lib/auth'
import { getActiveDb } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const db = await getActiveDb()
  return Response.json({ comments: db.listAllComments() })
}
