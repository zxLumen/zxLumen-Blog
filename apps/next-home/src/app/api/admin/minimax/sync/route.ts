import { setMinimaxSyncData, verifySyncKey, setLastError, type MinimaxSyncPayload, type MinimaxStoredRecord } from '@/lib/minimax'

export const dynamic = 'force-dynamic'

/**
 * MiniMax 书签同步端点(跨站,仅放行 minimax.cn 子域)。
 *
 * 鉴权:**X-Sync-Key**(服务端随机生成 + 库内存储,管理员可在 admin 轮换)。
 * 跨站 POST 不带 zx_admin cookie,无法走 isAdmin,故走密钥校验。
 *
 * 载荷白名单:
 *   start / end           — YYYY-MM-DD 区间边界
 *   records[].*           — 控制台原始记录(最大 5000 条)
 *   quota                 — token_plan/usage 原始响应(结构未知,原样存)
 *
 * 服务端把 records 按 (天 × 模型 × API Key) 聚合后落库,本端点
 * **不存任何 MiniMax Cookie**,Cookie 始终留在浏览器侧。
 */
const MAX_RECORDS = 5000
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2MB

const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*minimax\.cn$/i

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

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function sanitizeRecord(r: unknown): MinimaxStoredRecord | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  return {
    consume_time: isString(o.consume_time) ? o.consume_time : undefined,
    model: isString(o.model) ? o.model : undefined,
    api_token_name: isString(o.api_token_name) ? o.api_token_name : undefined,
    consume_input_token: typeof o.consume_input_token === 'number' ? o.consume_input_token : Number(o.consume_input_token) || undefined,
    consume_output_token: typeof o.consume_output_token === 'number' ? o.consume_output_token : Number(o.consume_output_token) || undefined,
    consume_token: typeof o.consume_token === 'number' ? o.consume_token : Number(o.consume_token) || undefined,
    consume_cash: typeof o.consume_cash === 'number' ? o.consume_cash : Number(o.consume_cash) || undefined,
    consume_cash_after_voucher:
      typeof o.consume_cash_after_voucher === 'number' ? o.consume_cash_after_voucher : Number(o.consume_cash_after_voucher) || undefined,
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin')) })
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const key = req.headers.get('x-sync-key') ?? ''

  // 书签跨站请求,无 admin cookie,只校验同步密钥
  if (!verifySyncKey(key)) {
    return ok({ error: 'unauthorized' }, origin, 401)
  }

  // 体积保护
  const raw = await req.text().catch(() => '')
  if (raw.length > MAX_BODY_BYTES) {
    return ok({ error: `body 超过 ${MAX_BODY_BYTES} 字节上限` }, origin, 413)
  }

  let body: Partial<MinimaxSyncPayload> = {}
  try {
    body = JSON.parse(raw) as Partial<MinimaxSyncPayload>
  } catch {
    return ok({ error: 'bad body (JSON)' }, origin, 400)
  }

  const records = Array.isArray(body.records) ? body.records : []
  if (records.length === 0) {
    await setLastError('书签推送 records 为空')
    return ok({ error: 'records 为空' }, origin, 400)
  }
  if (records.length > MAX_RECORDS) {
    return ok({ error: `单次最多 ${MAX_RECORDS} 条,本次 ${records.length}` }, origin, 413)
  }

  const sanitized: MinimaxStoredRecord[] = []
  for (const r of records) {
    const s = sanitizeRecord(r)
    if (s) sanitized.push(s)
  }

  try {
    const stored = setMinimaxSyncData({
      start: isString(body.start) ? body.start : undefined,
      end: isString(body.end) ? body.end : undefined,
      records: sanitized,
      quota: body.quota,
    })
    return ok({ ok: true, rows: stored.rows.length, records: stored.records }, origin)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败'
    await setLastError(msg)
    return ok({ error: msg }, origin, 400)
  }
}
