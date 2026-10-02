import { isAdmin } from '@/lib/auth'
import { getDb, readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 会话 id(访客侧 UUID / 线上 32 位 hex);限制长度避免拿超长串去查库 */
const SID_RE = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * admin 对话日志接口。
 *
 * 原来是 `{logs: 最近 N 条消息, dayCounts}` —— 面板把消息流当列表渲染,一问一答被
 * 拆成两张卡片、不同访客的对话交错混排。现按 `session_id` 归并成「一次对话」返回,
 * 面板才有「这次聊了什么」的单位。访客昵称走 `/api/admin/visitor-alias` 单独取,
 * 本接口不与之耦合。
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const p = url.searchParams
  /**
   * 数字参数一律兜底:`Number('abc')` 是 NaN,直接传给 SQLite 会当成 NULL,
   * 让分页/天数静默失效。这里 clamp 成合法整数。
   */
  const int = (raw: string | null, dflt: number, lo: number, hi: number) => {
    const n = Math.trunc(Number(raw ?? dflt))
    return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt
  }
  const days = int(p.get('days'), 30, 1, 90)
  const limit = int(p.get('limit'), 12, 1, 50)
  const offset = int(p.get('offset'), 0, 0, 100_000)
  const q = (p.get('q') || '').slice(0, 100)
  const cid = (p.get('cid') || '').slice(0, 64)
  const day = (p.get('day') || '').slice(0, 10)

  const db = getDb()
  const page = db.listChatSessions({ limit, offset, q, cid, day })
  // 一次批量取回本页会话的完整消息,避免每张卡一次请求
  const messages = db.listChatLogsBySessions(page.sessions.map((s) => s.session_id))
  const bySid = new Map<string, typeof messages>()
  for (const m of messages) {
    const arr = bySid.get(m.session_id)
    if (arr) arr.push(m)
    else bySid.set(m.session_id, [m])
  }
  return Response.json(
    {
      sessions: page.sessions.map((s) => ({ ...s, messages: bySid.get(s.session_id) ?? [] })),
      total: page.total,
      offset,
      limit,
      hasMore: offset + page.sessions.length < page.total,
      dayCounts: db.chatDayCounts(days),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * 清理对话日志。三种粒度,都比「一把清空」安全:
 *   POST   { action:'delete-session', session_id }  删一次对话(每张卡右上角的「删本次」)
 *   POST   { action:'prune', keep_days }            只保留最近 N 个北京日(含今天)
 *   DELETE ?confirm=1                               全清;不带 confirm 只回报待删条数
 * POST 用 { action } 与同目录 distill / corpus 路由的约定一致。
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ action?: string; session_id?: string; keep_days?: number }>(req).catch(
    () => null,
  )
  const db = getDb()

  if (body?.action === 'delete-session') {
    const sid = (body.session_id ?? '').trim()
    if (!SID_RE.test(sid)) return Response.json({ error: '会话 id 不合法' }, { status: 400 })
    return Response.json({ ok: true, deleted: db.deleteChatSession(sid) })
  }

  if (body?.action === 'prune') {
    const keep = Number(body.keep_days)
    if (!Number.isFinite(keep) || keep < 0) {
      return Response.json({ error: '保留天数不合法' }, { status: 400 })
    }
    return Response.json({ ok: true, deleted: db.pruneChatLogs(Math.trunc(keep)) })
  }

  return Response.json({ error: '未知 action' }, { status: 400 })
}

/**
 * 清空全部对话日志。**不带 `confirm=1` 只回报待删条数**,让面板先弹确认并告知影响
 * 范围,确认后才带 confirm 真正执行 —— 避免手滑点一下把整份对话记录抹掉。
 */
export async function DELETE(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const db = getDb()
  const sessions = db.listChatSessions({ limit: 1 }).total
  const messages = db.countChatLogs()
  if (new URL(req.url).searchParams.get('confirm') !== '1') {
    return Response.json({ ok: true, needConfirm: true, total: sessions, messages })
  }
  const deleted = db.deleteAllChatLogs()
  // sessions / messages 分开报:「几次对话」和「几条消息」不是一个量,别混用
  return Response.json({ ok: true, deleted, sessions, messages })
}