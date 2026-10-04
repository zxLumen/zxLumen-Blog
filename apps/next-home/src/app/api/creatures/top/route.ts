import { getDb } from '@/lib/db'
import { SCORE_VERSION } from '@zx/shared/creature'
import { rerankTop } from '@/lib/creature/rerank'

export const dynamic = 'force-dynamic'

/**
 * 全站生物榜单 —— 主页 Top5 与评分体系的可视出口。
 *
 * ## 分层
 *
 *  1. **候选池**:当前 `score_version` 的生物,按 `heur.total` 降序取前 N(默认 30)。
 *     heur 分是**唯一的分**,跨批次天然可比(同一纯函数 = 同一把尺子)。
 *  2. **VLM 精排**:只在缓存过期时,对候选池 Top 边界做相邻成对比较,用 BT 重排。
 *     失败/未配 key/无图 → 自动退回纯 heur 顺序(见 `lib/creature/rerank.ts`)。
 *  3. **缓存**:结果 + 时间戳落 `meta` 键 `creature_top_cache`,TTL 内直接返回,
 *     避免每次访问都调 VLM(真花钱)。新增生物时由 commit 侧删缓存立即失效。
 *
 * 查询参数:`?n=5`(返回条数)、`?fresh=1`(站长/调试强制重算)。
 */

const CACHE_KEY = 'creature_top_cache'
const CACHE_TTL_MS = 30 * 60_000 // 30 分钟
const CANDIDATE_POOL = 30

interface CachePayload {
  at: number
  /** 缓存时所用 score_version —— 版本一变即视为失效 */
  ver: string
  ids: number[]
}

/** 读缓存;版本不符或过期返回 null */
function readCache(db: Awaited<ReturnType<typeof getDb>>, fresh: boolean): number[] | null {
  if (fresh) return null
  const raw = db.getMeta(CACHE_KEY)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as CachePayload
    if (p.ver !== SCORE_VERSION) return null
    if (!Number.isFinite(p.at) || Date.now() - p.at > CACHE_TTL_MS) return null
    return p.ids
  } catch {
    return null
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const n = Math.max(1, Math.min(50, Number(url.searchParams.get('n')) || 5))
  const fresh = url.searchParams.get('fresh') === '1'

  const db = await getDb()

  // 候选池:heur 降序
  const pool = db.topCreatures(SCORE_VERSION, CANDIDATE_POOL)
  if (!pool.length) {
    return Response.json({ scoreVersion: SCORE_VERSION, items: [], reranked: false, cached: false })
  }

  const byId = new Map(pool.map((r) => [r.id, r]))

  // 缓存命中:按缓存顺序取前 n(缓存里存的是 id 顺序)
  const cached = readCache(db, fresh)
  let order: number[]
  let reranked: boolean
  let cachedHit = false

  if (cached && cached.length) {
    order = cached.filter((id) => byId.has(id))
    reranked = true
    cachedHit = true
    // 缓存顺序没覆盖到的(缓存后新增的)接在池子里剩余部分的 heur 顺序后
    for (const r of pool) if (!order.includes(r.id)) order.push(r.id)
  } else {
    // 精排:候选池按 heur 顺序,附上图的 data URL 不方便(读盘),改为传路径由前端拼;
    // rerank 需要 data URL,这里读文件转 base64。
    const withPng = await Promise.all(
      pool.map(async (r) => ({ id: r.id, png: r.png_path ? await readPngDataUrl(r.png_path) : '' })),
    )
    const res = await rerankTop(withPng)
    reranked = res.applied
    // 精排失败(未 applied)用纯 heur 顺序
    order = res.applied ? res.order : pool.map((r) => r.id)
    // 写缓存
    db.setMeta(CACHE_KEY, JSON.stringify({ at: Date.now(), ver: SCORE_VERSION, ids: order } satisfies CachePayload))
  }

  const items = order
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .slice(0, n)
    .map((r) => ({
      id: r.id,
      descr: r.descr,
      total: r.total,
      craft: r.craft,
      appeal: r.appeal,
      img: r.png_path ? `/creatures/${r.png_path}` : '',
      created_at: r.created_at,
    }))

  return Response.json({ scoreVersion: SCORE_VERSION, items, reranked, cached: cachedHit })
}

/** 读一张生物图转 data URL;读失败返回 ''(该只不参与精排) */
async function readPngDataUrl(name: string): Promise<string> {
  try {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const { creatureImgDir } = await import('@/lib/creature-dir')
    const buf = await readFile(path.join(creatureImgDir(), name))
    return 'data:image/png;base64,' + buf.toString('base64')
  } catch {
    return ''
  }
}
