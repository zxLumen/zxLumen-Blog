/**
 * 应用栏预览图清单（/apps/shots/manifest.json，由 scripts/app-shots.mjs 生成）。
 *
 * 预览图与清单都是可选的：文件不存在、JSON 坏了或某条缺字段时，前端一律
 * 当作「没有预览」处理，回退到原来的图标 + 直接打开应用，不阻塞应用栏。
 */

export interface AppShot {
  id: string
  name: string
  url: string
  /** 站内绝对路径，如 /apps/shots/github.webp */
  shot: string
  /** 一句话介绍 */
  intro: string
  /** 抓取时间（ISO） */
  capturedAt: string
}

export interface AppShotsManifest {
  generatedAt?: string
  apps: AppShot[]
}

const MANIFEST_URL = '/apps/shots/manifest.json'

function isShot(v: unknown): v is AppShot {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.name === 'string' &&
    typeof r.url === 'string' &&
    typeof r.shot === 'string' &&
    r.shot.startsWith('/apps/shots/') &&
    typeof r.intro === 'string' &&
    typeof r.capturedAt === 'string'
  )
}

/** 拉取清单并按 id 建索引；任何失败都返回空对象（静默降级） */
export async function loadAppShots(): Promise<Record<string, AppShot>> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' })
    if (!res.ok) return {}
    const data = (await res.json()) as unknown
    const raw =
      Array.isArray(data)
        ? data
        : data && typeof data === 'object' && Array.isArray((data as { apps?: unknown }).apps)
          ? (data as { apps: unknown[] }).apps
          : []
    const map: Record<string, AppShot> = {}
    for (const item of raw) {
      if (isShot(item)) map[item.id] = item
    }
    return map
  } catch {
    return {}
  }
}
