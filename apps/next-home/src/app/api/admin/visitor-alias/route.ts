import { isAdmin } from '@/lib/auth'
import { getDb, readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 访客匿名 ID:线上是 32 位 hex;MOCK 身份是短 id(同 /api/admin/mock) */
const CID_RE = /^[a-z0-9_-]{1,32}$/
const ALIAS_MAX = 40

/** admin 访客备注接口(别名仅站长可见):
 *   GET  → { aliases: VisitorAlias[] }        全部已备注访客
 *   POST → { cid, alias }                     写入备注;alias 为空 = 清除
 */
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const res = Response.json({ aliases: (await getDb()).listVisitorAliases() })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ cid?: string; alias?: string }>(req).catch(() => null)
  const cid = (body?.cid ?? '').trim()
  const alias = (body?.alias ?? '').trim().slice(0, ALIAS_MAX)
  if (!CID_RE.test(cid)) return Response.json({ error: 'cid 不合法' }, { status: 400 })
  const row = (await getDb()).setVisitorAlias(cid, alias)
  return Response.json({ ok: true, alias: row })
}