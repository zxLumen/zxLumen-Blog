import type { LinkItem, TechItem, TimelineEntry, SiteMeta } from './content.js'

export interface SectionHeader {
  tag?: string
  title?: string
  num?: string
}

export interface SiteSections {
  projects?: SectionHeader
  usage?: SectionHeader
  about?: SectionHeader
  guestbook?: SectionHeader
}

/** DB 覆盖(meta.site_content):叠加在运行时 content.json 之上,缺省字段回退基底 */
export interface SiteContentOverride {
  PROFILE?: Partial<{
    name: string
    handle: string
    title: string
    location: string
    statusLine: string
    bioLines: string[]
    email: string
  }>
  LINKS?: LinkItem[]
  TECH?: TechItem[]
  TIMELINE?: TimelineEntry[]
  SITE_META?: Partial<SiteMeta>
  SECTIONS?: SiteSections
}

function mergeObject<T extends object>(base: T, override: Partial<T> | undefined): T {
  if (!override) return base
  const res = { ...(base as Record<string, unknown>) } as Record<string, unknown>
  for (const k of Object.keys(override) as Array<keyof T>) {
    const v = override[k]
    if (v === undefined) continue
    if (Array.isArray(v)) {
      res[k as string] = (v as unknown[]).slice()
      continue
    }
    if (v && typeof v === 'object') {
      const b = (base as Record<string, unknown>)[k as string]
      if (b && typeof b === 'object' && !Array.isArray(b)) {
        res[k as string] = { ...(b as Record<string, unknown>), ...(v as Record<string, unknown>) }
      } else {
        res[k as string] = { ...(v as Record<string, unknown>) }
      }
      continue
    }
    res[k as string] = v
  }
  return res as unknown as T
}

/**
 * 把 DB 覆盖叠加到运行时内容基底上:
 *  - 数组(LINKS/TECH/TIMELINE)整组**替换**;
 *  - 对象(PROFILE/SITE_META/SECTIONS)按字段**浅合并**;
 *  - 未覆盖的键原样保留基底的值。
 */
export function mergeSiteContent<
  T extends {
    PROFILE: object
    LINKS: unknown[]
    TECH: unknown[]
    TIMELINE: unknown[]
    SITE_META: object
  },
>(base: T, override: SiteContentOverride | undefined): T & { SECTIONS?: SiteSections } {
  if (!override) return base
  const out: T & { SECTIONS?: SiteSections } = {
    ...base,
    PROFILE: mergeObject(base.PROFILE, override.PROFILE as never),
    LINKS: override.LINKS ?? base.LINKS,
    TECH: override.TECH ?? base.TECH,
    TIMELINE: override.TIMELINE ?? base.TIMELINE,
    SITE_META: mergeObject(base.SITE_META, override.SITE_META as never),
  }
  if (override.SECTIONS) out.SECTIONS = override.SECTIONS
  return out
}
