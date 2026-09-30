// 应用栏图标目录(仅服务端):
// 站长在 /admin「应用」面板上传的图标写这里(docker/site-content/apps/<id>.<ext>),
// 由 Caddy 经 /apps/* 静态服务(本地由 apps/next-home/public/apps 软链提供,同一路径两端通用)。
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** 目录不存在时创建(容器里目录已由挂载提供;本地首次跑需要建) */
function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 解析图标目录,优先级:
 *  1. APPS_ICON_DIR(显式覆盖)
 *  2. CONTENT_FILE 同级的 apps/ —— 容器里即 /srv/site/apps,本地即
 *     <repo>/docker/site-content/apps
 *  3. 沿 cwd 向上找仓库默认位置
 */
export function appIconDir(): string {
  const explicit = process.env.APPS_ICON_DIR?.trim()
  if (explicit) return ensureDir(explicit)
  if (process.env.CONTENT_FILE) {
    return ensureDir(path.join(path.dirname(process.env.CONTENT_FILE), 'apps'))
  }
  let dir = process.cwd()
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, 'docker', 'site-content', 'apps')
    if (existsSync(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ensureDir(path.join(process.cwd(), 'apps'))
}

/** 图标文件名(按 id 派生,与库里的 `/apps/<id>.<ext>` 对应) */
export function appIconName(id: string, ext: string): string {
  return `${id}.${ext === 'jpeg' ? 'jpg' : ext}`
}
