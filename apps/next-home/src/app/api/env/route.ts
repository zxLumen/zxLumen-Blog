import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/auth'
import { ENV_COOKIE, testModeAvailable } from '@/lib/env'
import { getTestDb, readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { isTestMode } = await import('@/lib/env')
  return Response.json({ test: await isTestMode(), available: testModeAvailable() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!testModeAvailable()) {
    return Response.json({ error: '测试模式在当前环境已禁用' }, { status: 403 })
  }

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
