import { readdirSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { imageSize } from '@/lib/image-size'
import { appIconDir, appIconName } from '@/lib/app-icon-dir'
import { getStoredApps, patchAppIcon } from '@/lib/app-config'

export const dynamic = 'force-dynamic'

/** 客户端已压到长边 256 的 PNG(通常几十~几百 KB),这里留足余量 */
const MAX_BYTES = 2 * 1024 * 1024

/** 真实类型 → 落盘扩展名(不信任上传声明的 MIME,以魔数解析结果为准) */
const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i

/** 声明宽高的合理上限(客户端压到长边 256;留足余量同时挡掉荒谬值) */
const MAX_EDGE = 8192

/**
 * 校验图片真的能被浏览器解码,而不只是「头几个字节像」。
 *
 * `imageSize()` 对 PNG 是直接读 16/20 处的宽高,不验证结构 —— 一个
 * 「PNG 签名 + 64 个 0x07」的文件会被读成 117901063×117901063 并通过。
 * 所以这里额外要求:
 *  1. PNG 签名后紧跟合法的 IHDR 块(长度字段 == 13、类型 == 'IHDR')
 *  2. 宽高落在 1..MAX_EDGE
 * 挡不住的伪造文件顶多让浏览器解码失败(前端回退名称首字),但至少不会
 * 把一张本来能用的图标覆盖成打不开的垃圾文件。
 */
function isDecodableImage(buf: Buffer, w: number, h: number, type: string): boolean {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return false
  if (w > MAX_EDGE || h > MAX_EDGE) return false
  if (type !== 'png') return true
  // IHDR 必须是第一个块:8 字节签名 + 长度(4,须为 13) + 类型(4,须为 IHDR)
  if (buf.length < 8 + 4 + 4 + 13) return false
  if (buf.readUInt32BE(8) !== 13) return false
  return buf.toString('ascii', 12, 16) === 'IHDR'
}

/** 写文件失败多半是宿主机目录没给容器内用户(uid 10001)写权限 */
function writeHint(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return '图标目录不可写:宿主机需执行 sudo chown -R 10001:10001 ~/zxLumen-Blog/docker/site-content/apps'
  }
  return (e as Error)?.message || '写入失败'
}

/** 清掉某 id 换格式后残留的其它扩展名(免得留垃圾文件) */
function purgeOtherExt(dir: string, id: string, keep: string): void {
  try {
    for (const f of readdirSync(dir)) {
      if (f === keep) continue
      if (/^[a-z0-9-]{1,40}\.(?:jpg|jpeg|png|webp)$/i.test(f) && f.slice(0, f.lastIndexOf('.')) === id) {
        unlinkSync(path.join(dir, f))
      }
    }
  } catch {
    // 目录读不到就当没有旧文件
  }
}

// 站长上传的应用栏图标(存 docker/site-content/apps/<id>.<ext>):
//   POST   multipart: id + file  → 写文件 + 立刻写库(不用点面板「保存」)
//   DELETE { id }                 → 删文件并清空 icon 字段(前端回落到名称首字)
// 同一路径两端通用:本地 public/apps 软链,生产 Caddy /apps/* 静态服务。
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return Response.json({ error: '需要 multipart/form-data' }, { status: 400 })
  const id = String(form.get('id') ?? '').trim()
  const file = form.get('file')
  if (!ID_RE.test(id)) return Response.json({ error: '缺少合法的 id' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: '缺少图片文件' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: '图片过大(需 ≤ 2MB)' }, { status: 400 })
  }
  if (!getStoredApps().some((a) => a.id === id)) {
    return Response.json({ error: '该应用不在配置里,请先保存列表' }, { status: 404 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const size = imageSize(buf)
  const ext = size ? EXT[size.type] : undefined
  if (!size || !ext) {
    return Response.json({ error: '只支持 JPEG / PNG / WebP(按文件内容判断)' }, { status: 400 })
  }
  if (!isDecodableImage(buf, size.width, size.height, size.type)) {
    return Response.json(
      { error: `图片内容不合法或尺寸异常(读到 ${size.width}x${size.height}),已拒绝(不会覆盖现有图标)` },
      { status: 400 },
    )
  }
  // 极小的图多半是误传,提示而不是静默接受
  if (size.width < 64 || size.height < 64) {
    return Response.json({ error: `图片太小(${size.width}x${size.height}),请用至少 64px 的图` }, { status: 400 })
  }

  const dir = appIconDir()
  const name = appIconName(id, ext)
  try {
    await writeFile(path.join(dir, name), buf)
  } catch (e) {
    return Response.json({ error: `保存图标失败:${writeHint(e)}` }, { status: 500 })
  }
  purgeOtherExt(dir, id, name)

  const apps = patchAppIcon(id, `/apps/${name}`)
  if (!apps) return Response.json({ error: '该应用不在配置里,请先保存列表' }, { status: 404 })

  return Response.json({ ok: true, apps, icon: `/apps/${name}`, w: size.width, h: size.height })
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ id?: unknown }>(req)
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!ID_RE.test(id)) return Response.json({ error: '缺少合法的 id' }, { status: 400 })
  if (!getStoredApps().some((a) => a.id === id)) {
    return Response.json({ error: '该应用不在配置里' }, { status: 404 })
  }

  const dir = appIconDir()
  const removed: string[] = []
  purgeAllExt(dir, id, removed)

  const apps = patchAppIcon(id, undefined)
  return Response.json({ ok: true, apps, removed })
}

/** 收集并删除该 id 的全部格式旧图(DELETE 用) */
function purgeAllExt(dir: string, id: string, removed: string[]): void {
  try {
    for (const f of readdirSync(dir)) {
      if (/^[a-z0-9-]{1,40}\.(?:jpg|jpeg|png|webp)$/i.test(f) && f.slice(0, f.lastIndexOf('.')) === id) {
        unlinkSync(path.join(dir, f))
        removed.push(f)
      }
    }
  } catch {
    // 目录读不到就当没有上传图,下面的清字段照样跑
  }
}
