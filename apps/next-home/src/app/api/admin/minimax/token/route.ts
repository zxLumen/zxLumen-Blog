import {
  setMinimaxCredential,
  clearMinimaxCredential,
  verifySyncKey,
  fetchMinimaxUsageFromServer,
  getAuthAt,
} from '@/lib/minimax'

export const dynamic = 'force-dynamic'

/**
 * MiniMax 书签**授权**端点(跨站,仅放行 minimax.cn 子域)。
 *
 * 书签在 `*.minimax.cn` 控制台页面点,读出 JS 可读的登录凭证
 * (整段 `document.cookie`,含 `_token`)POST 到这里;服务端保存后
 * **立即拉一次**,之后由 `ensureMinimaxScheduler()` 每 10 分钟自动同步。
 *
 * 鉴权:`X-Sync-Key`(跨站不带 zx_admin cookie,故用密钥校验)。
 * 凭证仅存服务器,不下发前端。
 */
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*minimax\.(cn|io|com)$/i

function cors(origin: string | null) {
  const ok = origin && ALLOWED_ORIGIN.test(origin) ? origin : 'https://www.minimax.cn'
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function ok(body: unknown, origin: string | null, status = 200) {
  return Response.json(body, { status, headers: cors(origin) })
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const key = req.headers.get('x-sync-key') ?? ''

  if (!verifySyncKey(key)) return ok({ error: 'unauthorized' }, origin, 401)

  const raw = await req.text().catch(() => '')
  let body: { cookie?: unknown; groupId?: unknown } = {}
  try {
    body = JSON.parse(raw) as typeof body
  } catch {
    return ok({ error: 'bad body (JSON)' }, origin, 400)
  }

  const cookie = typeof body.cookie === 'string' ? body.cookie.trim() : ''
  const groupId = typeof body.groupId === 'string' ? body.groupId.trim() : ''
  if (!cookie.includes('_token')) {
    return ok({ error: '未读到登录凭证(_token);请确认已登录 minimax.cn 后再点书签' }, origin, 400)
  }

  await setMinimaxCredential(cookie, groupId)

  // 立即拉一次:成功才认为授权有效、自动同步开启
  try {
    const stored = await fetchMinimaxUsageFromServer('30d')
    return ok(
      {
        ok: true,
        autoSync: true,
        rows: stored.rows.length,
        records: stored.records,
        authAt: await getAuthAt(),
      },
      origin,
    )
  } catch (e) {
    // 首次拉取失败:清掉刚存的凭证(避免误报「自动同步中」),书签会自动回退到直推数据
    clearMinimaxCredential()
    const msg = e instanceof Error ? e.message : '拉取失败'
    return ok({ ok: false, autoSync: false, error: msg }, origin, 200)
  }
}
