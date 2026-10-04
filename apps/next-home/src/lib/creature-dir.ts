// 访客生物 PNG 目录(仅服务端):
// 访客创建生物时浏览器端出图,提交时写在这里(<id>.png),由 Caddy 经 /creatures/*
// 静态服务(本地由 apps/next-home/public/creatures 软链提供,同一路径两端通用)。
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** 目录不存在时创建(容器里目录已由挂载提供;本地首次跑需要建) */
function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 解析生物图目录,优先级:
 *  1. CREATURE_IMG_DIR(显式覆盖)
 *  2. CONTENT_FILE 同级的 creatures/ —— 容器里即 /srv/site/creatures,本地即
 *     <repo>/docker/site-content/creatures
 *  3. 沿 cwd 向上找仓库默认位置
 */
export function creatureImgDir(): string {
  const explicit = process.env.CREATURE_IMG_DIR?.trim()
  if (explicit) return ensureDir(explicit)
  if (process.env.CONTENT_FILE) {
    return ensureDir(path.join(path.dirname(process.env.CONTENT_FILE), 'creatures'))
  }
  let dir = process.cwd()
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, 'docker', 'site-content', 'creatures')
    if (existsSync(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ensureDir(path.join(process.cwd(), 'creatures'))
}

/** 生物图文件名(以生物 id 命名,覆盖时 id 不变故文件名稳定) */
export function creatureImgName(id: number): string {
  return `${id}.png`
}
