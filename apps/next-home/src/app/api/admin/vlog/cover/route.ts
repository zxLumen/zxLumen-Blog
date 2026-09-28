import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { imageSize } from '@/lib/image-size'
import {
  fallbackCoverName,
  userCoverName,
  vlogCoverDir,
} from '@/lib/vlog-cover-dir'
import {
  getStoredVlogs,
  isLandscapeVideo,
  patchVideoCover,
} from '@/lib/vlog-config'
import type { StoredVlogVideo } from '@zx/shared'

export const dynamic = 'force-dynamic'

/** 客户端已压到长边 1280 的 JPEG(约 100~300KB),这里留足余量 */
const MAX_BYTES = 3 * 1024 * 1024

/** 真实类型 → 落盘扩展名(不信任上传声明的 MIME,以魔数解析结果为准) */
const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

/** 找到某 vid 首次出现的视频对象(同一 vid 可能在多个系列里) */
function findVideo(vid: string): StoredVlogVideo | null {
  for (const s of getStoredVlogs()) {
    for (const v of s.videos) if (v.vid === vid) return v
  }
  return null
}

/** 写文件失败多半是宿主机目录没给容器内用户(uid 10001)写权限 */
function writeHint(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return '封面目录不可写:宿主机需执行 sudo chown -R 10001:10001 ~/zxLumen-Blog/docker/site-content/vlog'
  }
  return (e as Error)?.message || '写入失败'
}

// 站长自己提供的视频封面(存 docker/site-content/vlog/<vid>.user.jpg,覆盖兜底首帧):
//   POST   multipart: vid + file  → 写文件 + 立刻写库(不用点面板「保存」)
//   DELETE { vid }                → 删文件,回落到兜底首帧(有)或清空(竖屏无兜底图)
// 同一路径两端通用:本地 public/vlog 软链,生产 Caddy /vlog/* 静态服务。
// 兜底首帧 <vid>.jpg 不走这里 —— 由本地 `npm run cover:push` 生成后经 SSH 推送。
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return Response.json({ error: '需要 multipart/form-data' }, { status: 400 })
  const vid = String(form.get('vid') ?? '').trim()
  const file = form.get('file')
  if (!/^\d{6,}$/.test(vid)) return Response.json({ error: '缺少合法的 vid' }, { status: 400 })
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: '缺少图片文件' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: '图片过大(需 ≤ 3MB)' }, { status: 400 })
  }
  const video = findVideo(vid)
  if (!video) return Response.json({ error: '该视频不在配置里,请先保存列表' }, { status: 404 })

  const buf = Buffer.from(await file.arrayBuffer())
  const size = imageSize(buf)
  const ext = size ? EXT[size.type] : undefined
  if (!size || !ext) {
    return Response.json({ error: '只支持 JPEG / PNG / WebP(按文件内容判断)' }, { status: 400 })
  }
  // 极小的图多半是误传,提示而不是静默接受
  if (size.width < 320 || size.height < 320) {
    return Response.json({ error: `图片太小(${size.width}x${size.height}),请用至少 320px 的图` }, { status: 400 })
  }

  const dir = vlogCoverDir()
  const name = ext === 'jpg' ? userCoverName(vid) : `${vid}.user.${ext}`
  try {
    await writeFile(path.join(dir, name), buf)
  } catch (e) {
    return Response.json({ error: `保存封面失败:${writeHint(e)}` }, { status: 500 })
  }
  // 换了格式时清掉上一种格式的旧上传图,免得留垃圾文件
  for (const f of readdirSync(dir)) {
    if (f.startsWith(`${vid}.user.`) && f !== name) unlinkSync(path.join(dir, f))
  }

  const at = new Date().toISOString()
  const series = patchVideoCover(vid, { cover: `/vlog/${name}`, coverSrc: 'user', coverAt: at })
  if (!series) return Response.json({ error: '该视频不在配置里,请先保存列表' }, { status: 404 })

  // 方向不一致不拦(前端会等比缩放 + 补黑边),只给一句提示
  const imgLandscape = size.width > size.height
  const vidLandscape = isLandscapeVideo(video)
  const hint =
    imgLandscape === vidLandscape
      ? null
      : imgLandscape
        ? `这张是横图(${size.width}x${size.height}),竖屏卡片会上下补黑边`
        : `这张是竖图(${size.width}x${size.height}),横屏卡片会左右补黑边`

  return Response.json({ ok: true, series, cover: `/vlog/${name}`, at, hint })
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ vid?: unknown }>(req)
  const vid = typeof body?.vid === 'string' ? body.vid.trim() : ''
  if (!/^\d{6,}$/.test(vid)) return Response.json({ error: '缺少合法的 vid' }, { status: 400 })
  if (!findVideo(vid)) return Response.json({ error: '该视频不在配置里' }, { status: 404 })

  // 清掉所有格式的旧上传图(.user.jpg / .user.png / .user.webp)
  const dir = vlogCoverDir()
  const removed: string[] = []
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`${vid}.user.`)) {
        unlinkSync(path.join(dir, f))
        removed.push(f)
      }
    }
  } catch {
    // 目录读不到就当没有上传图,下面的回填逻辑照样跑
  }

  // 回落到兜底首帧:文件在就写回路径(前端按 cover 优先),竖屏没有兜底图 → 直接清空
  const fallback = path.join(dir, fallbackCoverName(vid))
  const hasFallback = existsSync(fallback)
  const at = hasFallback ? new Date(statSync(fallback).mtimeMs).toISOString() : undefined
  const series = patchVideoCover(
    vid,
    hasFallback
      ? { cover: `/vlog/${fallbackCoverName(vid)}`, coverSrc: 'douyin', coverAt: at }
      : { cover: undefined, coverSrc: undefined, coverAt: undefined },
  )
  return Response.json({
    ok: true,
    series,
    removed,
    fallback: hasFallback ? `/vlog/${fallbackCoverName(vid)}` : null,
    at,
  })
}
