import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  clearMinimaxData,
  getLastError,
  getSnapshotStatus,
  getSyncKey,
} from '@/lib/minimax'

export const dynamic = 'force-dynamic'

async function status() {
  const [key, snap, err] = await Promise.all([getSyncKey(), getSnapshotStatus(), getLastError()])
  return {
    syncKey: key,
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
  const body = await readJson<{ action?: string }>(req).catch(() => null)
  const action = body?.action

  if (action === 'clear') {
    clearMinimaxData()
    return Response.json({ ok: true, ...(await status()) })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
