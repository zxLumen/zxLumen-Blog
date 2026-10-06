import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  clearMinimaxData,
  fetchMinimaxHistory,
  fetchMinimaxQuota,
  getLastError,
  getMinimaxQuota,
  getSession,
  getSnapshotStatus,
  getSubKey,
  sessionExpiry,
  setSession,
  setSubKey,
} from '@/lib/minimax'

export const dynamic = 'force-dynamic'

async function status() {
  const [snap, err, subKey, session, quota] = await Promise.all([
    getSnapshotStatus(),
    getLastError(),
    getSubKey(),
    getSession(),
    Promise.resolve(getMinimaxQuota()),
  ])
  return {
    configured: !!subKey || !!session || !!snap,
    subKeySet: !!subKey,
    sessionSet: !!session,
    sessionExp: session ? sessionExpiry(session) : null,
    quota: quota || null,
    lastData: snap || null,
    lastError: err || null,
  }
}

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json(await status())
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ action?: string; key?: string; cookie?: string }>(req).catch(() => null)
  const action = body?.action

  // 订阅 Key → 额度自动同步
  if (action === 'saveKey') {
    const key = (body?.key ?? '').trim()
    if (!key) return Response.json({ error: '请粘贴订阅 Key' }, { status: 400 })
    if (!/^sk-/.test(key)) return Response.json({ error: 'Key 应以 sk- 开头(订阅 Key 形如 sk-cp-...)' }, { status: 400 })
    await setSubKey(key)
    try {
      const quota = await fetchMinimaxQuota()
      return Response.json({ ok: true, models: quota.models.length, ...(await status()) })
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : '额度校验失败', ...(await status()) }, { status: 400 })
    }
  }

  // 会话 Cookie → 逐天历史自动同步
  if (action === 'saveSession') {
    const cookie = (body?.cookie ?? '').trim()
    if (!cookie) return Response.json({ error: '请粘贴 Cookie' }, { status: 400 })
    if (!cookie.includes('_token')) {
      return Response.json({ error: 'Cookie 里没有 _token,请从 DevTools 复制 www.minimax.cn 请求的完整 Cookie' }, { status: 400 })
    }
    await setSession(cookie)
    try {
      const stored = await fetchMinimaxHistory('30d')
      return Response.json({ ok: true, rows: stored.rows.length, records: stored.records, ...(await status()) })
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : '历史拉取失败', ...(await status()) }, { status: 400 })
    }
  }

  if (action === 'clear') {
    clearMinimaxData()
    return Response.json({ ok: true, ...(await status()) })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
