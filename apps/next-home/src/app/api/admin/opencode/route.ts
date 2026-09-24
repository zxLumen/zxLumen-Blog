import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getConsoleUrl,
  setConsoleUrl,
  getWorkspaces,
  setWorkspaces,
  getLastError,
  setLastError,
  getSnapshotStatus,
  fetchUsageOpenCodeWs,
  type OcWorkspace,
} from '@/lib/opencode'

export const dynamic = 'force-dynamic'

async function status() {
  const ws = await getWorkspaces()
  return {
    configured: ws.length > 0,
    consoleUrl: await getConsoleUrl(),
    workspaces: ws.map((w) => ({ id: w.id, name: w.name, hasKey: !!w.key })),
    lastData: (await getSnapshotStatus()) || null,
    lastError: (await getLastError()) || null,
  }
}

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  return Response.json(await status())
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const data = await readJson<{ action?: string; consoleUrl?: string; workspaces?: unknown; wsId?: string }>(req)
  const action = data?.action

  if (action === 'save') {
    const input = Array.isArray(data?.workspaces) ? (data.workspaces as Array<Partial<OcWorkspace>>) : null
    if (!input) return Response.json({ error: '缺少 workspaces 列表' }, { status: 400 })
    // 已有项若未重新输入 key(空),沿用库中原 key(避免前端拿不到 key 而被清空)
    const existing = new Map((await getWorkspaces()).map((w) => [w.id, w.key]))
    const merged = input.map((w) => ({
      ...w,
      key: (w.key ?? '').trim() || existing.get(w.id ?? '') || '',
    }))
    const bad = merged.find((w) => w.key && !w.key.startsWith('oc_sk_'))
    if (bad) {
      return Response.json(
        { error: '服务账号 Key 需为 oc_sk_ 开头(在 Console 创建;网页令牌 / sk- API Key 会被官方拒绝)' },
        { status: 400 },
      )
    }
    const url = (data?.consoleUrl ?? '').trim()
    if (url) await setConsoleUrl(url)
    await setWorkspaces(merged)
    await setLastError('')
    return Response.json({ ok: true, ...(await status()) })
  }

  if (action === 'refresh') {
    const list = await getWorkspaces()
    if (list.length === 0) return Response.json({ error: '未配置 workspace', ...(await status()) }, { status: 400 })
    const errors: string[] = []
    let total = 0
    for (const w of list) {
      try {
        const r = await fetchUsageOpenCodeWs(w, '30d')
        total += r.rows.length
      } catch (e) {
        const code = (e as { code?: string }).code
        errors.push(
          `${w.name}:${code === 'UNCONFIGURED' ? '未配置 Key' : code === 'INVALID_KEY' ? '密钥无效或无权限' : e instanceof Error ? e.message : '拉取失败'}`,
        )
      }
    }
    await setLastError(errors.join(';'))
    if (errors.length === list.length) {
      return Response.json({ error: errors.join(';'), ...(await status()) }, { status: 400 })
    }
    return Response.json({ ok: true, rows: total, ...(await status()) })
  }

  if (action === 'clear') {
    await setWorkspaces([])
    await setConsoleUrl('')
    await setLastError('')
    return Response.json({ ok: true, ...(await status()) })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
