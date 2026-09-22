import { isAdmin } from '@/lib/auth'
import { verifyAdminPassword, setAdminPassword, hasCustomPassword } from '@/lib/settings'
import { readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ custom: await hasCustomPassword() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const data = await readJson<{ current?: string; next?: string }>(req)
  const current = data?.current ?? ''
  const next = (data?.next ?? '').trim()

  if (!(await verifyAdminPassword(current))) {
    return Response.json({ error: '当前密码错误' }, { status: 400 })
  }
  if (next.length < 4 || next.length > 64) {
    return Response.json({ error: '新密码需 4-64 位' }, { status: 400 })
  }

  await setAdminPassword(next)
  return Response.json({ ok: true })
}
