import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  clearMinimaxData,
  fetchMinimaxQuota,
  getLastError,
  getMinimaxQuota,
  getSnapshotStatus,
  getSubKey,
  getSyncKey,
  rotateSyncKey,
  setSubKey,
} from '@/lib/minimax'

export const dynamic = 'force-dynamic'

async function status() {
  const [key, snap, err, subKey, quota] = await Promise.all([
    getSyncKey(),
    getSnapshotStatus(),
    getLastError(),
    getSubKey(),
    Promise.resolve(getMinimaxQuota()),
  ])
  return {
    syncKey: key,
    configured: !!subKey || !!snap,
    subKeySet: !!subKey,
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
  const body = await readJson<{ action?: string; key?: string }>(req).catch(() => null)
  const action = body?.action

  if (action === 'save') {
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

  if (action === 'clear') {
    clearMinimaxData()
    return Response.json({ ok: true, ...(await status()) })
  }

  if (action === 'rotate') {
    await rotateSyncKey()
    return Response.json({ ok: true, ...(await status()) })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
