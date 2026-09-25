import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { clearKb, distillStatus, generatePersona, processCorpus } from '@/lib/chat/distill'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return Response.json({ ok: true, ...(await distillStatus()) })
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

interface Body {
  action?: 'process' | 'persona' | 'clear'
  force?: boolean
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<Body>(req)
  const action = body?.action ?? 'process'
  try {
    if (action === 'process') {
      const items = await processCorpus(!!body?.force)
      return Response.json({ ok: true, action, items })
    }
    if (action === 'persona') {
      const r = await generatePersona()
      return Response.json({ ok: true, action, ...r })
    }
    if (action === 'clear') {
      clearKb()
      return Response.json({ ok: true, action })
    }
    return Response.json({ ok: false, error: '未知 action' }, { status: 400 })
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 300) }, { status: 500 })
  }
}