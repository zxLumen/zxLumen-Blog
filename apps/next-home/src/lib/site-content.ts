import crypto from 'node:crypto'
import { getRuntimeContent, type RuntimeContent } from '@zx/shared/server'
import {
  mergeSiteContent,
  type SiteContentOverride,
  type SiteSections,
} from '@zx/shared'
import { getDb } from './db'

const SITE_CONTENT_META_KEY = 'site_content'

export type { SiteContentOverride, SectionHeader, SiteSections } from '@zx/shared'

export type MergedSiteContent = RuntimeContent & { SECTIONS?: SiteSections }

function computeRev(obj: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj ?? {}))
    .digest('hex')
    .slice(0, 16)
}

export async function getSiteContentOverride(): Promise<SiteContentOverride> {
  const db = await getDb()
  const raw = db.getMeta(SITE_CONTENT_META_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as SiteContentOverride
  } catch {
    return {}
  }
}

export async function getSiteContent(): Promise<MergedSiteContent> {
  const base = await getRuntimeContent()
  const ov = await getSiteContentOverride()
  return mergeSiteContent(base, ov)
}

export async function getSiteContentRev(): Promise<string> {
  const ov = await getSiteContentOverride()
  return computeRev(ov)
}

/**
 * 保存:带乐观锁。调用方(API)负责在 409 时提示前端重读。
 * 合并策略:按 section 浅合并,未提交的字段维持原覆盖值。
 */
export async function saveSiteContent(partial: SiteContentOverride, rev: string): Promise<void> {
  const db = await getDb()
  const current = await getSiteContentOverride()
  const currentRev = computeRev(current)
  if (rev !== currentRev) {
    const err = new Error('rev 冲突(409)') as Error & { status?: number }
    err.status = 409
    throw err
  }
  const next: SiteContentOverride = {
    ...current,
    ...partial,
    PROFILE: { ...(current.PROFILE ?? {}), ...(partial.PROFILE ?? {}) },
    SITE_META: { ...(current.SITE_META ?? {}), ...(partial.SITE_META ?? {}) },
    SECTIONS: { ...(current.SECTIONS ?? {}), ...(partial.SECTIONS ?? {}) },
  }
  db.setMeta(SITE_CONTENT_META_KEY, JSON.stringify(next))
}
