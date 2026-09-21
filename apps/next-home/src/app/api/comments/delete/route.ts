import { getActiveDb, featureOn } from '@/lib/env'
import { readJson } from '@/lib/db'
import { effectiveCid } from '@/lib/clientid'

export const dynamic = 'force-dynamic'

interface Body {
  id?: number
}

/** 访客删除自己的留言(按匿名 ID 校验;递归删除其下回复) */
export async function POST(req: Request) {
  if (!(await featureOn('self-delete'))) {
    return Response.json({ error: '该功能尚未开放' }, { status: 403 })
  }
  const data = await readJson<Body>(req)
  const id = typeof data?.id === 'number' ? data.id : null
  if (id === null) return Response.json({ error: '缺少 id' }, { status: 400 })

  const cid = await effectiveCid()
  if (!cid) return Response.json({ error: '只能删除自己的留言' }, { status: 403 })

  const db = await getActiveDb()
  const owner = db.getCommentCid(id)
  if (owner === null) return Response.json({ error: '留言不存在' }, { status: 404 })
  if (!owner || owner !== cid) {
    return Response.json({ error: '只能删除自己的留言' }, { status: 403 })
  }

  db.archiveComment(id, 'visitor')
  return Response.json({ ok: true })
}
