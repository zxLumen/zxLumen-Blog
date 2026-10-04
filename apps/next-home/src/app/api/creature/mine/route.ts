import { getDb } from '@/lib/db'
import { effectiveCid } from '@/lib/clientid'

export const dynamic = 'force-dynamic'

/**
 * 当前访客自己的生物列表 —— 创建页「我的 5 只 / 选择覆盖」用它。
 * 只返回本人的;`cid` 取自 cookie(与创建、提交同一套身份)。
 */
export async function GET(): Promise<Response> {
  const cid = await effectiveCid()
  if (!cid) return Response.json({ creatures: [], count: 0 })

  const db = await getDb()
  const rows = db.listByCid(cid)
  return Response.json({
    count: rows.length,
    creatures: rows.map((r) => ({
      id: r.id,
      descr: r.descr,
      total: r.total,
      craft: r.craft,
      appeal: r.appeal,
      png_path: r.png_path,
      created_at: r.created_at,
    })),
  })
}
