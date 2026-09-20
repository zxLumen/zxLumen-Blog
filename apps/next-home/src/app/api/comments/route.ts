import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/auth'
import { getActiveDb } from '@/lib/env'
import { rateLimit, readJson, clientIp } from '@/lib/db'
import { getAdminNick } from '@/lib/settings'
import type { Visibility } from '@zx/shared'

export const dynamic = 'force-dynamic'

/** 访客匿名 ID cookie:httpOnly,仅服务端可见,用于让作者看到自己的私密留言 */
const CID_COOKIE = 'zx_cid'

function cidCookie(cid: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${CID_COOKIE}=${cid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`
}

async function resolveCid(): Promise<{ cid: string; isNew: boolean }> {
  const raw = (await cookies()).get(CID_COOKIE)?.value ?? ''
  if (raw) return { cid: raw, isNew: false }
  return { cid: randomBytes(16).toString('hex'), isNew: true }
}

/** 归一化昵称用于比较:去空白 + 转小写 */
const normNick = (s: string) => s.replace(/\s+/g, '').toLowerCase()

interface Body {
  author?: string
  author_link?: string
  body?: string
  visibility?: Visibility
  parent_id?: number | null
}

export async function GET(req: Request) {
  const db = await getActiveDb()
  const admin = await isAdmin()
  const { cid, isNew } = await resolveCid()
  const url = new URL(req.url)
  const page = Number(url.searchParams.get('page') || 1)
  const pageSize = Number(url.searchParams.get('pageSize') || 20)
  const data = db.listThreadPage({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    includePrivate: admin,
    viewerCid: cid,
  })
  const res = Response.json(data)
  if (isNew) res.headers.append('Set-Cookie', cidCookie(cid))
  return res
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!rateLimit(ip)) {
    return Response.json({ error: '太频繁了,稍后再试' }, { status: 429 })
  }

  const data = await readJson<Body>(req)
  if (!data) return Response.json({ error: '请求体无效' }, { status: 400 })

  const admin = await isAdmin()
  const author = (data.author ?? '').trim()
  const body = (data.body ?? '').trim()
  const link = (data.author_link ?? '').trim()
  const visibility: Visibility = data.visibility === 'private' ? 'private' : 'public'
  const parent_id = typeof data.parent_id === 'number' ? data.parent_id : null

  if (author.length < 1 || author.length > 32) {
    return Response.json({ error: '昵称需 1-32 字' }, { status: 400 })
  }
  if (body.length < 2 || body.length > 500) {
    return Response.json({ error: '留言需 2-500 字' }, { status: 400 })
  }
  if (link && !/^https?:\/\//i.test(link)) {
    return Response.json({ error: '链接需以 http(s):// 开头' }, { status: 400 })
  }

  // 非管理员不得冒用站长昵称
  if (!admin && normNick(author) === normNick(getAdminNick())) {
    return Response.json({ error: '该昵称为站长保留,请换一个昵称' }, { status: 403 })
  }

  const db = await getActiveDb()
  if (parent_id !== null) {
    const parent = db.getComment(parent_id)
    if (!parent) return Response.json({ error: '回复目标不存在' }, { status: 400 })
  }

  const { cid, isNew } = await resolveCid()
  const comment = db.addComment({
    author,
    author_link: link,
    body,
    visibility,
    parent_id,
    is_admin: admin ? 1 : 0,
    ip,
    author_cid: cid,
  })
  const res = Response.json({ comment }, { status: 201 })
  if (isNew) res.headers.append('Set-Cookie', cidCookie(cid))
  return res
}
