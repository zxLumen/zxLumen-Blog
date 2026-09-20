import { isAdmin } from '@/lib/auth'
import { getAdminNick, setAdminNick } from '@/lib/settings'
import { readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ nick: getAdminNick() })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const data = await readJson<{ nick?: string }>(req)
  const nick = (data?.nick ?? '').trim()
  if (nick.length < 1 || nick.length > 32) {
    return Response.json({ error: '昵称需 1-32 字' }, { status: 400 })
  }
  setAdminNick(nick)
  return Response.json({ ok: true, nick })
}
