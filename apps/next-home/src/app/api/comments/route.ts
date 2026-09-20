import { isAdmin } from '@/lib/auth'
import { getActiveDb } from '@/lib/env'
import { rateLimit, readJson, clientIp } from '@/lib/db'
import type { Visibility } from '@zx/shared'

export const dynamic = 'force-dynamic'

interface Body {
  author?: string
  author_link?: string
  body?: string
  visibility?: Visibility
  parent_id?: number | null
}

export async function GET() {
  const db = await getActiveDb()
  const admin = await isAdmin()
  return Response.json({ comments: admin ? db.listAllComments() : db.listPublicComments() })
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

  const db = await getActiveDb()
  if (parent_id !== null) {
    const parent = db.getComment(parent_id)
    if (!parent) return Response.json({ error: '回复目标不存在' }, { status: 400 })
  }

  const comment = db.addComment({
    author,
    author_link: link,
    body,
    visibility,
    parent_id,
    is_admin: admin ? 1 : 0,
    ip,
  })
  return Response.json({ comment }, { status: 201 })
}
