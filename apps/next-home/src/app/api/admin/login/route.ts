import { cookies } from 'next/headers'
import { readJson } from '@/lib/db'
import { verifyAdminPassword } from '@/lib/settings'
import { ADMIN_COOKIE, adminCookieOptions, newAdminSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const data = await readJson<{ password?: string }>(req)
  if (!data?.password || !(await verifyAdminPassword(data.password))) {
    return Response.json({ error: '密码错误' }, { status: 401 })
  }
  const store = await cookies()
  store.set(ADMIN_COOKIE, newAdminSession(), adminCookieOptions())
  return Response.json({ ok: true })
}
