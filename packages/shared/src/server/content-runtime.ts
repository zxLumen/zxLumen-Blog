// 运行时站点内容(仅服务端,勿在客户端组件引用):
// 读取 CONTENT_FILE(默认仓库 docker/site-content/content.json)并校验合并,
// 内存缓存 + 每次 mtime 比对 → 改 content.json 后刷新页面即生效(无需重启)。
import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_CONTENT } from '../content.js'
import type { RuntimeContent } from '../content.js'

/** 解析 content.json 路径:优先 CONTENT_FILE 环境变量,否则沿 cwd 向上找仓库默认位置 */
function resolveFile(): string {
  if (process.env.CONTENT_FILE) return process.env.CONTENT_FILE
  let dir = process.cwd()
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, 'docker', 'site-content', 'content.json')
    if (existsSync(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(process.cwd(), 'content.json')
}

const FILE = resolveFile()

let cache: { mtimeMs: number; data: RuntimeContent } | null = null

/** 逐字段合并,缺省补占位,防止手抄 JSON 漏字段导致站点崩 */
function normalize(p: Partial<RuntimeContent>): RuntimeContent {
  return {
    PROFILE: { ...DEFAULT_CONTENT.PROFILE, ...p.PROFILE },
    LINKS: p.LINKS ?? DEFAULT_CONTENT.LINKS,
    TECH: p.TECH ?? DEFAULT_CONTENT.TECH,
    TIMELINE: p.TIMELINE ?? DEFAULT_CONTENT.TIMELINE,
    PROJECTS: p.PROJECTS ?? DEFAULT_CONTENT.PROJECTS,
    SITE_META: { ...DEFAULT_CONTENT.SITE_META, ...p.SITE_META },
    CONTACTS: { ...DEFAULT_CONTENT.CONTACTS, ...p.CONTACTS },
  }
}

/**
 * 读取运行时站点内容(异步);失败时回退占位默认值,不阻塞页面。
 * 内存级 mtime 缓存让 content.json 热更新立即可见。
 */
export async function getRuntimeContent(): Promise<RuntimeContent> {
  try {
    const st = await stat(FILE)
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.data
    const raw = await readFile(FILE, 'utf8')
    const data = normalize(JSON.parse(raw) as Partial<RuntimeContent>)
    cache = { mtimeMs: st.mtimeMs, data }
    return data
  } catch {
    return DEFAULT_CONTENT
  }
}