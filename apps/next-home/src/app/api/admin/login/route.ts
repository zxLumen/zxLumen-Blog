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
  const session = newAdminSession()
  if (!session) {
    return Response.json({ error: '服务未配置 SESSION_SECRET,登录不可用' }, { status: 503 })
  }
  const store = await cookies()
  store.set(ADMIN_COOKIE, session, adminCookieOptions())
  return Response.json({ ok: true })
}
