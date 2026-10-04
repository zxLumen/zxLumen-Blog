import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getDb, rateLimit, clientIp } from '@/lib/db'
import { cidCookie, isMockActive, resolveCid } from '@/lib/clientid'
import { creatureImgDir, creatureImgName } from '@/lib/creature-dir'
import {
  MAX_CREATURES_PER_CID,
} from '@zx/shared/server'
import {
  normalizeBlueprint,
  compileBlueprint,
  heuristicScore,
  SCORE_VERSION,
  type CreatureBlueprint,
} from '@zx/shared/creature'

export const dynamic = 'force-dynamic'

/**
 * 创建/覆盖一只访客生物 —— 评分体系的数据入口。
 *
 * 分工:生成(也就是 blueprint)走 `/api/creature/generate`(队列 + 预算 + 限流),
 * 出图在**浏览器端**完成(真实渲染器 → PNG)。这里只做**提交**:校验 → 打分 → 落库
 * + 落图。这样"评了多少只"与"创建了几只"解耦,生成失败的样本从不进榜。
 *
 * 打分**只在服务端做**,且用纯函数 `heuristicScore` —— 客户端无法伪造分数。
 *
 * 落库的是原始分(craft/appeal/total)+ `score_version`;排名读取时算,改权重零迁移。
 *
 * 配额:每访客最多 `MAX_CREATURES_PER_CID` 只。满了必须带 `replaceId` 覆盖某只
 * (不占新槽)。每日生成次数由 `/api/creature/generate` 侧的预算单独管。
 */

interface Body {
  descr?: string
  blueprint?: CreatureBlueprint
  /** 浏览器出好的 PNG data URL(png) */
  png?: string
  /** 覆盖模式:要替换掉的那只(必须是本人的) */
  replaceId?: number
}

/** 只接受 png data URL;上限防超大 base64 */
const PNG_RE = /^data:image\/png;base64,/i
const MAX_PNG = 6_000_000 // ~4.5MB 二进制,300×300 的 PNG 远小于此

function json(body: Record<string, unknown>, status: number, setCid?: string): Response {
  const h = new Headers({ 'Content-Type': 'application/json' })
  if (setCid) h.append('Set-Cookie', cidCookie(setCid))
  return new Response(JSON.stringify(body), { status, headers: h })
}

function writeHint(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return '生物图目录不可写:宿主机需执行 sudo chown -R 10001:10001 ~/zxLumen-Blog/docker/site-content/creatures'
  }
  return (e as Error)?.message || '写入失败'
}

/** 把 PNG data URL 的 base64 部分解成 Buffer;非 PNG / 解析失败返回 null */
function decodePng(dataUrl: string): Buffer | null {
  try {
    const b64 = dataUrl.replace(PNG_RE, '')
    const buf = Buffer.from(b64, 'base64')
    // PNG 魔数:89 50 4E 47 0D 0A 1A 0A
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      return null
    }
    return buf
  } catch {
    return null
  }
}

export async function POST(req: Request): Promise<Response> {
  // 生成是花钱的、创建是写库的;两者都是写操作,做一个低成本防刷(生成侧另有队列+预算闸门)
  const ip = clientIp(req)
  if (!rateLimit(`creature-commit:${ip}`, 30, 60_000)) {
    return Response.json({ error: '提交太频繁,稍等一下', retryable: true }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const descr = (body.descr ?? '').trim().slice(0, 300)
  if (!descr) return json({ error: '描述不能为空' }, 400)

  const norm = normalizeBlueprint(body.blueprint)
  if (!norm) return json({ error: '骨架不可用' }, 400)

  const png = body.png ?? ''
  if (!PNG_RE.test(png)) return json({ error: '图片格式不支持(需 PNG data URL)' }, 400)
  if (png.length > MAX_PNG) return json({ error: '图片太大' }, 400)
  const buf = decodePng(png)
  if (!buf) return json({ error: '图片解析失败' }, 400)

  // 服务端算分(客户端无法伪造)
  const cc = compileBlueprint(norm)
  const score = heuristicScore(cc.dna, descr, {
    parts: norm.parts,
    motionFamily: norm.motionCfg?.family,
    span: norm.span,
    motionRules: Object.values(norm.motionCfg?.rules ?? {}),
  })
  const shared = {
    descr,
    blueprint: JSON.stringify(norm),
    dna: JSON.stringify(cc.dna),
    craft: score.craft,
    appeal: score.appeal,
    total: score.total,
    score_version: SCORE_VERSION,
  }

  const { cid, isNew } = await resolveCid()
  const db = await getDb()
  const setCid = isNew ? cid : ''
  // MOCK 访客在调试期可超出 5 只上限(拿来看访客视角,别被配额卡住)
  const exempt = await isMockActive()

  let id: number
  if (typeof body.replaceId === 'number' && Number.isFinite(body.replaceId)) {
    const replaced = db.replaceCreature(body.replaceId, cid, { ...shared, png_path: '' })
    if (!replaced) return json({ error: '要覆盖的生物不存在或不属于你' }, 404, setCid)
    id = replaced.id
  } else {
    if (!exempt && db.countByCid(cid) >= MAX_CREATURES_PER_CID) {
      return json(
        {
          error: `你已经有 ${MAX_CREATURES_PER_CID} 只了,再创建需要选择覆盖一只`,
          needReplace: true,
          limit: MAX_CREATURES_PER_CID,
        },
        409,
        setCid,
      )
    }
    const row = db.addCreature({ cid, ...shared, png_path: '' })
    id = row.id
  }

  // 落图:文件名以 id 命名(覆盖时 id 不变,同名覆盖,不产生垃圾文件)
  const name = creatureImgName(id)
  try {
    await writeFile(path.join(creatureImgDir(), name), buf)
  } catch (e) {
    // 图写失败:分已落库但无图。榜单仍可用 heur 分,只是不显示缩略图 —— 不因此回滚。
    return json({ error: `保存图片失败:${writeHint(e)}` }, 500, setCid)
  }
  db.replaceCreature(id, cid, { ...shared, png_path: name })

  // 榜单缓存失效:新生物可能进 Top5,下次访问重算(含 VLM 精排)
  db.delMeta('creature_top_cache')

  return json({ id, png_path: name, score: { craft: score.craft, appeal: score.appeal, total: score.total } }, 201, setCid)
}
