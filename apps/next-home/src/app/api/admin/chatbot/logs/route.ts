import { isAdmin } from '@/lib/auth'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 1), 90)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200)
  const db = getDb()
  const logs = db.listChatLogs({ limit })
  const dayCounts = db.chatDayCounts(days)
  return Response.json({ logs, dayCounts }, { headers: { 'Cache-Control': 'no-store' } })
}

/** 清空对话历史 */
export async function DELETE() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  getDb().deleteAllChatLogs()
  return Response.json({ ok: true })
}