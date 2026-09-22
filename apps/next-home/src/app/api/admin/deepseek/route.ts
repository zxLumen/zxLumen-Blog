import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getToken,
  setToken,
  getSyncKey,
  rotateSyncKey,
  getSyncAt,
  setSyncAt,
  getLastError,
  setLastError,
  getLastData,
  jwtExp,
  fetchUsage,
} from '@/lib/deepseek'

export const dynamic = 'force-dynamic'

function status() {
  const token = getToken()
  const exp = token ? jwtExp(token) : null
  return {
    configured: !!token,
    exp,
    expired: exp ? exp < Date.now() : null,
    lastSync: getSyncAt(),
    syncKey: getSyncKey(),
    lastError: getLastError() || null,
    lastData: getLastData() ? (JSON.parse(getLastData() as string) as unknown) : null,
  }
}

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json(status())
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const data = await readJson<{ action?: string; token?: string }>(req)
  const action = data?.action

  if (action === 'save') {
    const token = (data?.token ?? '').trim()
    if (token.startsWith('sk-')) {
      return Response.json({ error: '这是 API Key(sk-),需网页登录令牌 userToken' }, { status: 400 })
    }
    if (!token) {
      return Response.json({ error: '请填入 userToken' }, { status: 400 })
    }
    setToken(token)
    setSyncAt(new Date().toISOString())
    return Response.json({ ok: true, ...status() })
  }

  if (action === 'refresh') {
    try {
      const r = await fetchUsage('30d')
      return Response.json({ ok: true, rows: r.rows.length, ...status() })
    } catch (e) {
      const code = (e as { code?: string }).code
      return Response.json(
        { error: code === 'INVALID_TOKEN' ? '令牌失效' : e instanceof Error ? e.message : '拉取失败', ...status() },
        { status: 400 },
      )
    }
  }

  if (action === 'rotate') {
    return Response.json({ ok: true, syncKey: rotateSyncKey() })
  }

  if (action === 'clear') {
    setToken('')
    setLastError('')
    return Response.json({ ok: true, ...status() })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
