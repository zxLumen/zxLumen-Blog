import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { MOCK_COOKIE } from '@/lib/clientid'

export const dynamic = 'force-dynamic'

const ID_RE = /^[a-z0-9_-]{1,32}$/

/** 设置 / 清除"模拟访客"身份(仅站长) */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const data = await readJson<{ cid?: string }>(req)
  const cid = (data?.cid ?? '').trim()

  if (cid && !ID_RE.test(cid)) {
    return Response.json({ error: 'id 仅限 1-32 位小写字母/数字/_/-' }, { status: 400 })
  }

  const store = await cookies()
  if (!cid) {
    store.delete(MOCK_COOKIE)
    return Response.json({ ok: true, cid: null })
  }
  store.set(MOCK_COOKIE, cid, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return Response.json({ ok: true, cid })
}
