import { NextRequest } from 'next/server'
import { isAdmin } from '@/lib/auth'
import { getSiteContent, getSiteContentRev, saveSiteContent, type SiteContentOverride } from '@/lib/site-content'

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: '未授权' }, { status: 401 })
  const content = await getSiteContent()
  const rev = await getSiteContentRev()
  return Response.json({ content, rev })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return Response.json({ error: '未授权' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const partial = (body?.partial ?? {}) as SiteContentOverride
  const rev = body?.rev as string
  if (!rev) return Response.json({ error: '缺少 rev' }, { status: 400 })
  try {
    await saveSiteContent(partial, rev)
  } catch (e: unknown) {
    const err = e as { status?: number }
    if (err?.status === 409) {
      return Response.json({ error: 'rev 冲突', rev: await getSiteContentRev() }, { status: 409 })
    }
    return Response.json({ error: '内部错误' }, { status: 500 })
  }
  const content = await getSiteContent()
  const newRev = await getSiteContentRev()
  return Response.json({ ok: true, content, rev: newRev })
}

export async function DELETE() {
  if (!(await isAdmin())) return Response.json({ error: '未授权' }, { status: 401 })
  const { getDb } = await import('@/lib/db')
  const db = await getDb()
  const SITE_CONTENT_META_KEY = 'site_content'
  db.setMeta(SITE_CONTENT_META_KEY, JSON.stringify({}))
  return Response.json({ ok: true })
}
