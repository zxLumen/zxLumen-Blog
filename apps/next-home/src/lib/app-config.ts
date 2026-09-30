import type { AppItem, AppOpenIn, StoredApp } from '@zx/shared'
import { normalizeUrl } from '@zx/shared'
import { getDb } from './db'

const META_KEY = 'apps_config'

/** id 允许的字符:同时用于生成落盘文件名,必须足够严格 */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i

/** 图标只接受本站 `/apps/` 下的固定形态(兜底 `<id>.<ext>` / 站长上传同名),避免任意 URL 注入 */
const ICON_RE = /^\/apps\/[a-z0-9][a-z0-9-]{0,39}\.(?:jpg|jpeg|png|webp)$/i

/** 出厂默认应用(未配置时的初始列表;不落库,保存后才生效) */
const DEFAULT_APPS: AppItem[] = [
  { id: 'github', name: 'GitHub', url: 'https://github.com/zxlumen' },
  { id: 'resume', name: '简历', url: '/resume.pdf' },
]

/** 规范化单条(过滤非法值,兜底字段);无 id 则丢弃 */
function normalizeOne(raw: unknown): StoredApp | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  if (!ID_RE.test(id)) return null
  const url = normalizeUrl(typeof r.url === 'string' ? r.url : '')
  if (!url) return null
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id
  const icon =
    typeof r.icon === 'string' && ICON_RE.test(r.icon.trim()) ? r.icon.trim() : undefined
  // 只认 'self';留空/未知(未来的 'panel' 等)一律按 newtab 落库,不会把老数据搞坏
  const openIn: AppOpenIn = r.openIn === 'self' ? 'self' : 'newtab'
  const group = typeof r.group === 'string' && r.group.trim() ? r.group.trim() : undefined
  return {
    id,
    name,
    url,
    ...(icon ? { icon } : {}),
    openIn,
    ...(group ? { group } : {}),
    deleted: r.deleted === true,
  }
}

/** 规范化整表(丢弃非法条目) */
export function normalizeAppList(input: unknown): StoredApp[] {
  return Array.isArray(input)
    ? input.map(normalizeOne).filter((a): a is StoredApp => a !== null)
    : []
}

/**
 * 读取完整应用列表(含垃圾箱)。
 * 只在**从未配置过**时回退出厂默认;一旦配置过就以配置为准 ——
 * 包括「配置成一个空数组」(站长想暂时撤掉整个应用栏)。
 */
export function getStoredApps(): StoredApp[] {
  try {
    const raw = getDb().getMeta(META_KEY)
    if (raw === null) return DEFAULT_APPS.map((a) => ({ ...a }))
    return normalizeAppList(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_APPS.map((a) => ({ ...a }))
  }
}

/** 规范化后写入整表(数组顺序即展示顺序) */
export function saveStoredApps(input: unknown): StoredApp[] {
  const list = normalizeAppList(input)
  getDb().setMeta(META_KEY, JSON.stringify(list))
  return list
}

/** 恢复为出厂默认(删除配置) */
export function resetStoredApps(): StoredApp[] {
  getDb().delMeta(META_KEY)
  return DEFAULT_APPS.map((a) => ({ ...a }))
}

/** 仅取前端要展示的应用(排除垃圾箱),转成展示形状 */
export function getVisibleApps(): AppItem[] {
  return getStoredApps()
    .filter((a) => !a.deleted)
    .map(({ deleted, ...rest }) => {
      void deleted
      return rest
    })
}

/**
 * 就地改某一条的图标字段并整表写回。只动 icon,不碰名称/地址/顺序/删除态 ——
 * 面板上传图标走这里,不经过「整表保存」那条路,避免和编辑中的列表互相覆盖。
 * id 不在配置里返回 null(调用方需提示先保存列表)。
 */
export function patchAppIcon(id: string, icon: string | undefined): StoredApp[] | null {
  const list = getStoredApps()
  if (!list.some((a) => a.id === id)) return null
  const next = list.map((a) => {
    if (a.id !== id) return a
    const merged = { ...a }
    // 字段值为 undefined = 清除该字段(回落到 name 首字)
    if (icon === undefined) delete merged.icon
    else merged.icon = icon
    return merged
  })
  getDb().setMeta(META_KEY, JSON.stringify(next))
  return next
}
