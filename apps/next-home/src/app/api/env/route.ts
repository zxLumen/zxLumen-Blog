import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/auth'
import { ENV_COOKIE } from '@/lib/env'
import { getTestDb, readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const data = await readJson<{ mode?: 'test' | 'live'; reset?: boolean }>(req)

  if (data?.reset) {
    return Response.json({ ok: true, removed: getTestDb().clearComments() })
  }

  const store = await cookies()
  const mode = data?.mode === 'test' ? 'test' : 'live'
  if (mode === 'test') {
    store.set(ENV_COOKIE, 'test', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
  } else {
    store.delete(ENV_COOKIE)
  }
  return Response.json({ ok: true, mode })
}
