import { setMinimaxSyncData, setLastError, verifySyncKey, type MinimaxEntry } from '@/lib/minimax'

export const dynamic = 'force-dynamic'

/**
 * MiniMax 书签同步端点(跨站,仅放行 minimax.cn 子域)。
 *
 * 书签在 `*.minimax.cn` 控制台页面点 → 同源 fetch `usage_hourly_detail`
 * (浏览器自动带 HttpOnly 的 `_token` Cookie)→ 把 `entries` POST 到这里。
 * **Cookie 始终留在浏览器,服务器零凭证**。
 *
 * 鉴权:`X-Sync-Key`(跨站不带 zx_admin cookie,故用密钥校验)。
 */
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*minimax\.(cn|io|com)$/i
const MAX_ENTRIES = 20000
const MAX_BODY_BYTES = 4 * 1024 * 1024

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
  if (raw.length > MAX_BODY_BYTES) return ok({ error: `body 超过 ${MAX_BODY_BYTES} 字节上限` }, origin, 413)

  let body: { start?: unknown; end?: unknown; entries?: unknown } = {}
  try {
    body = JSON.parse(raw) as typeof body
  } catch {
    return ok({ error: 'bad body (JSON)' }, origin, 400)
  }

  const entries = Array.isArray(body.entries) ? (body.entries as MinimaxEntry[]) : []
  if (entries.length === 0) {
    await setLastError('书签推送 entries 为空')
    return ok({ error: 'entries 为空' }, origin, 400)
  }
  if (entries.length > MAX_ENTRIES) {
    return ok({ error: `单次最多 ${MAX_ENTRIES} 条,本次 ${entries.length}` }, origin, 413)
  }

  try {
    const stored = setMinimaxSyncData({
      start: typeof body.start === 'string' ? body.start : undefined,
      end: typeof body.end === 'string' ? body.end : undefined,
      entries,
    })
    return ok({ ok: true, rows: stored.rows.length, records: stored.records }, origin)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败'
    await setLastError(msg)
    return ok({ error: msg }, origin, 400)
  }
}
