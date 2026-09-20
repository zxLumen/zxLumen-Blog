import { getSyncKey, setToken, setSyncAt, setLastError } from '@/lib/deepseek'

export const dynamic = 'force-dynamic'

const ORIGIN = 'https://platform.deepseek.com'

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key',
    'Access-Control-Max-Age': '600',
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() })
}

export async function POST(req: Request) {
  if (req.headers.get('x-sync-key') !== getSyncKey()) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors() })
  }
  const text = await req.text()
  let token = ''
  try {
    token = (JSON.parse(text) as { token?: string }).token ?? ''
  } catch {
    return Response.json({ error: 'bad body' }, { status: 400, headers: cors() })
  }
  if (!token || token.split('.').length < 2) {
    return Response.json({ error: 'invalid token' }, { status: 400, headers: cors() })
  }
  setToken(token)
  setSyncAt(new Date().toISOString())
  setLastError('')
  return Response.json({ ok: true }, { headers: cors() })
}
