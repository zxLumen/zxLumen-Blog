import { setSyncedToken, verifySyncKey } from '@/lib/deepseek'

export const dynamic = 'force-dynamic'

const ORIGIN = 'https://platform.deepseek.com'

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() })
}

export async function POST(req: Request) {
  if (!verifySyncKey(req.headers.get('x-sync-key') ?? '')) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors() })
  }
  const text = await req.text()
  let token = ''
  try {
    token = (JSON.parse(text) as { token?: string }).token ?? ''
  } catch {
    return Response.json({ error: 'bad body' }, { status: 400, headers: cors() })
  }
  if (token.startsWith('sk-')) {
    return Response.json({ error: 'API Key(sk-)不能用作同步令牌,需网页登录 userToken' }, { status: 400, headers: cors() })
  }
  if (!token) {
    return Response.json({ error: 'token required' }, { status: 400, headers: cors() })
  }
  setSyncedToken(token)
  return Response.json({ ok: true }, { headers: cors() })
}
