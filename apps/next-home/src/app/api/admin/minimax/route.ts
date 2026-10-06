import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  clearMinimaxData,
  fetchMinimaxUsageFromServer,
  getAuthAt,
  getAuthError,
  getLastError,
  getMinimaxCookie,
  getSnapshotStatus,
  setAuthError,
  setMinimaxCredential,
} from '@/lib/minimax'

export const dynamic = 'force-dynamic'

async function status() {
  const [snap, err, cookie, authAt, authError] = await Promise.all([
    getSnapshotStatus(),
    getLastError(),
    getMinimaxCookie(),
    getAuthAt(),
    getAuthError(),
  ])
  return {
    configured: !!cookie,
    autoSync: !!cookie && !authError,
    authAt: authAt || null,
    authError: authError || null,
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
  const body = await readJson<{ action?: string; cookie?: string; groupId?: string }>(req).catch(() => null)
  const action = body?.action

  if (action === 'save') {
    const cookie = (body?.cookie ?? '').trim()
    if (!cookie) return Response.json({ error: '请粘贴 Cookie' }, { status: 400 })
    if (!cookie.includes('_token')) {
      return Response.json(
        { error: 'Cookie 里没有 _token,请从 DevTools 复制 www.minimax.cn 请求的完整 Cookie' },
        { status: 400 },
      )
    }
    // group_id 优先取手动填写,否则从 cookie 里的 minimax_group_id_v2 提取
    let groupId = (body?.groupId ?? '').trim()
    if (!groupId) {
      const m = cookie.match(/(?:^|;\s*)minimax_group_id_v2=([^;]+)/)
      if (m) groupId = decodeURIComponent(m[1])
    }
    await setMinimaxCredential(cookie, groupId)
    // 立即拉一次:成功才算授权有效
    try {
      const stored = await fetchMinimaxUsageFromServer('30d')
      return Response.json({ ok: true, rows: stored.rows.length, records: stored.records, ...(await status()) })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '拉取失败'
      await setAuthError(msg)
      return Response.json({ error: msg, ...(await status()) }, { status: 400 })
    }
  }

  if (action === 'clear') {
    clearMinimaxData()
    return Response.json({ ok: true, ...(await status()) })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
