import type { Project, StoredProject } from '@zx/shared'
import { normalizeUrl } from '@zx/shared'
import { getRuntimeContent } from '@zx/shared/server'
import { getDb } from './db'

const META_KEY = 'projects_config'

const STATUSES: Project['status'][] = ['online', 'demo', 'building', 'archived']
const KINDS: NonNullable<Project['kind']>[] = ['personal', 'work']

/** 缺省推断:本站(demoUrl='/')视为个人项目,其余视为历史工作成果 */
function inferKind(demoUrl?: string): NonNullable<Project['kind']> {
  return demoUrl === '/' ? 'personal' : 'work'
}

/** 静态 PROJECTS → StoredProject(作为未配置时的初始列表;内容来自运行时 content.json) */
async function fromStatic(): Promise<StoredProject[]> {
  const { PROJECTS } = await getRuntimeContent()
  return PROJECTS.map((p) => ({
    id: p.id,
    name: p.name,
    desc: p.desc,
    tech: p.tech ?? [],
    status: p.status,
    kind: p.kind ?? inferKind(p.demoUrl),
    period: p.period,
    demoUrl: p.demoUrl,
    repoUrl: p.repoUrl,
    highlights: p.highlights,
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
  const demoUrl = normalizeUrl(typeof r.demoUrl === 'string' ? r.demoUrl : '')
  const kind = KINDS.includes(r.kind as NonNullable<Project['kind']>)
    ? (r.kind as NonNullable<Project['kind']>)
    : inferKind(demoUrl)
  const highlights = Array.isArray(r.highlights)
    ? (r.highlights as unknown[])
        .map((h) => {
          const o = (h ?? {}) as Record<string, unknown>
          const label = typeof o.label === 'string' ? o.label.trim() : ''
          const value = typeof o.value === 'string' ? o.value.trim() : ''
          return label && value ? { label, value } : null
        })
        .filter((h): h is { label: string; value: string } => h !== null)
    : []
  return {
    id,
    name: typeof r.name === 'string' && r.name ? r.name : id,
    desc: typeof r.desc === 'string' ? r.desc : '',
    tech,
    status,
    kind,
    period: typeof r.period === 'string' ? r.period : '',
    demoUrl,
    repoUrl: normalizeUrl(typeof r.repoUrl === 'string' ? r.repoUrl : ''),
    highlights: highlights.length ? highlights : undefined,
    featured: r.featured === true,
    deleted: r.deleted === true,
  }
}

/**
 * 读取完整项目列表(含垃圾箱)。
 * 未配置时以静态 PROJECTS 为初始列表(不落库,保存后才生效)。
 * highlights 兜底:DB 项目自身未配时,按 id 取静态同项(恢复历史亮点;admin 与首页一致)。
 */
export async function getStoredProjects(): Promise<StoredProject[]> {
  let list: StoredProject[]
  try {
    const raw = getDb().getMeta(META_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    const mapped = Array.isArray(parsed)
      ? parsed.map(normalizeOne).filter((p): p is StoredProject => p !== null)
      : []
    list = mapped.length > 0 ? mapped : await fromStatic()
  } catch {
    return fromStatic()
  }
  // 静态 highlights 兜底
  try {
    const { PROJECTS } = await getRuntimeContent()
    const staticHl = new Map(PROJECTS.map((p) => [p.id, p.highlights]))
    return list.map((p) =>
      p.highlights?.length ? p : { ...p, highlights: staticHl.get(p.id)?.length ? staticHl.get(p.id) : undefined },
    )
  } catch {
    return list
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
      kind: p.kind,
      period: p.period || undefined,
      demoUrl: p.demoUrl || undefined,
      repoUrl: p.repoUrl || undefined,
      highlights: p.highlights?.length ? p.highlights : undefined,
      featured: p.featured || undefined,
    }))
}
