import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  clearMinimaxData,
  getLastError,
  getSnapshotStatus,
  getSyncKey,
  rotateSyncKey,
  setMinimaxSyncData,
  type MinimaxEntry,
} from '@/lib/minimax'

export const dynamic = 'force-dynamic'

async function status() {
  const [key, snap, err] = await Promise.all([getSyncKey(), getSnapshotStatus(), getLastError()])
  return {
    syncKey: key,
    configured: !!snap,
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
  const body = await readJson<{
    action?: string
    start?: string
    end?: string
    entries?: MinimaxEntry[]
  }>(req).catch(() => null)
  const action = body?.action

  if (action === 'clear') {
    clearMinimaxData()
    return Response.json({ ok: true, ...(await status()) })
  }

  if (action === 'rotate') {
    await rotateSyncKey()
    return Response.json({ ok: true, ...(await status()) })
  }

  // 浏览器直连同步(admin 面板「立即同步」):浏览器已拿到 entries,这里只负责入库
  if (action === 'ingest') {
    try {
      const stored = setMinimaxSyncData({ start: body?.start, end: body?.end, entries: body?.entries })
      return Response.json({ ok: true, rows: stored.rows.length, records: stored.records, ...(await status()) })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '入库失败'
      return Response.json({ error: msg }, { status: 400 })
    }
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
