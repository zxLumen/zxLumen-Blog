import { cookies } from 'next/headers'
import { ADMIN_PASSWORD, getDb, readJson } from '@/lib/db'
import { ADMIN_COOKIE, adminCookieOptions, newAdminToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const data = await readJson<{ password?: string }>(req)
  if (data?.password !== ADMIN_PASSWORD) {
    return Response.json({ error: '密码错误' }, { status: 401 })
  }
  const token = newAdminToken()
  getDb().setMeta('admin_token', token)
  const store = await cookies()
  store.set(ADMIN_COOKIE, token, adminCookieOptions())
  return Response.json({ ok: true })
}
