import { isAdmin } from '@/lib/auth'
import {
  getAdminNick,
  setAdminNick,
  getContactSettings,
  setContactSettings,
} from '@/lib/settings'
import { readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json({ nick: getAdminNick(), contacts: getContactSettings() })
}

interface Body {
  nick?: string
  contacts?: { email?: string; wechat?: string; phone?: string }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const data = await readJson<Body>(req)

  if (data?.nick !== undefined) {
    const nick = data.nick.trim()
    if (nick.length < 1 || nick.length > 32) {
      return Response.json({ error: '昵称需 1-32 字' }, { status: 400 })
    }
    setAdminNick(nick)
  }

  if (data?.contacts) {
    const c = data.contacts
    const email = (c.email ?? '').trim()
    const wechat = (c.wechat ?? '').trim()
    const phone = (c.phone ?? '').trim()
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return Response.json({ error: '邮箱格式不正确' }, { status: 400 })
    }
    if (/[^\d+\-\s]/.test(phone)) {
      return Response.json({ error: '电话只能包含数字/+/-/空格' }, { status: 400 })
    }
    setContactSettings({ email, wechat, phone })
  }

  return Response.json({ ok: true, nick: getAdminNick(), contacts: getContactSettings() })
}
