import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
import { ADMIN_COOKIE } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  getDb().delMeta('admin_token')
  const store = await cookies()
  store.delete(ADMIN_COOKIE)
  return Response.json({ ok: true })
}
