import type { Project, StoredProject } from '@zx/shared'
import { getRuntimeContent } from '@zx/shared/server'
import { getDb } from './db'

const META_KEY = 'projects_config'

const STATUSES: Project['status'][] = ['online', 'demo', 'building', 'archived']

/** 静态 PROJECTS → StoredProject(作为未配置时的初始列表;内容来自运行时 content.json) */
async function fromStatic(): Promise<StoredProject[]> {
  const { PROJECTS } = await getRuntimeContent()
  return PROJECTS.map((p) => ({
    id: p.id,
    name: p.name,
    desc: p.desc,
    tech: p.tech ?? [],
    status: p.status,
    period: p.period,
    demoUrl: p.demoUrl,
    repoUrl: p.repoUrl,
    featured: p.featured,
  }))
}

/** 规范化单条(过滤非法值,兜底字段) */
function normalizeOne(raw: unknown): StoredProject | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null
  if (!id) return null
  const status = STATUSES.includes(r.status as Project['status'])
    ? (r.status as Project['status'])
    : 'online'
  const tech = Array.isArray(r.tech)
    ? r.tech.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : typeof r.tech === 'string'
      ? r.tech.split(',').map((t) => t.trim()).filter(Boolean)
      : []
  return {
    id,
    name: typeof r.name === 'string' && r.name ? r.name : id,
    desc: typeof r.desc === 'string' ? r.desc : '',
    tech,
    status,
    period: typeof r.period === 'string' ? r.period : '',
    demoUrl: typeof r.demoUrl === 'string' ? r.demoUrl : '',
    repoUrl: typeof r.repoUrl === 'string' ? r.repoUrl : '',
    featured: r.featured === true,
    deleted: r.deleted === true,
  }
}

/**
 * 读取完整项目列表(含垃圾箱)。
 * 未配置时以静态 PROJECTS 为初始列表(不落库,保存后才生效)。
 */
export async function getStoredProjects(): Promise<StoredProject[]> {
  try {
    const raw = getDb().getMeta(META_KEY)
    if (!raw) return fromStatic()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return fromStatic()
    const list = parsed.map(normalizeOne).filter((p): p is StoredProject => p !== null)
    return list.length > 0 ? list : fromStatic()
  } catch {
    return fromStatic()
  }
}

/** 保存整表(数组顺序即展示顺序) */
export function saveStoredProjects(input: unknown): StoredProject[] {
  const list = Array.isArray(input)
    ? input.map(normalizeOne).filter((p): p is StoredProject => p !== null)
    : []
  getDb().setMeta(META_KEY, JSON.stringify(list))
  return list
}

/** 恢复为静态默认(删除配置) */
export async function resetStoredProjects(): Promise<StoredProject[]> {
  getDb().delMeta(META_KEY)
  return fromStatic()
}

/** 仅取首页要展示的项目(排除垃圾箱),并转回 Project 形状 */
export async function getVisibleProjects(): Promise<Project[]> {
  return (await getStoredProjects())
    .filter((p) => !p.deleted)
    .map((p) => ({
      id: p.id,
      name: p.name,
      desc: p.desc,
      tech: p.tech,
      status: p.status,
      period: p.period || undefined,
      demoUrl: p.demoUrl || undefined,
      repoUrl: p.repoUrl || undefined,
      featured: p.featured || undefined,
    }))
}
