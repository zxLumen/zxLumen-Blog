// 横屏/竖屏视频封面目录(仅服务端):
// 站长在 /admin 面板上传的封面写在这里(<vid>.user.jpg),兜底首帧(<vid>.jpg)由
// packages/shared/scripts/vlog-cover.mjs 抓取落在同一目录,两者都由 Caddy 经
// /vlog/* 静态服务(本地由 apps/next-home/public/vlog 软链提供,同一路径两端通用)。
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** 目录不存在时创建(容器里目录已由挂载提供;本地首次跑需要建) */
function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 解析封面目录,优先级:
 *  1. VLOG_COVER_DIR(显式覆盖)
 *  2. CONTENT_FILE 同级的 vlog/ —— 容器里即 /srv/site/vlog,本地即
 *     <repo>/docker/site-content/vlog
 *  3. 沿 cwd 向上找仓库默认位置
 */
export function vlogCoverDir(): string {
  const explicit = process.env.VLOG_COVER_DIR?.trim()
  if (explicit) return ensureDir(explicit)
  if (process.env.CONTENT_FILE) {
    return ensureDir(path.join(path.dirname(process.env.CONTENT_FILE), 'vlog'))
  }
  let dir = process.cwd()
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, 'docker', 'site-content', 'vlog')
    if (existsSync(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ensureDir(path.join(process.cwd(), 'vlog'))
}

/** 站长上传的封面文件名(与兜底首帧 <vid>.jpg 区分开,兜底图永远保持原样) */
export function userCoverName(vid: string): string {
  return `${vid}.user.jpg`
}

/** 兜底首帧文件名 */
export function fallbackCoverName(vid: string): string {
  return `${vid}.jpg`
}
