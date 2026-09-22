import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getApiKey,
  getBaseUrl,
  setApiKey,
  setBaseUrl,
  getLastError,
  setLastError,
  getSnapshotStatus,
  clearLastData,
  fetchUsageZhipu,
} from '@/lib/zhipu'

export const dynamic = 'force-dynamic'

async function status() {
  const configured = !!(await getApiKey())
  return {
    configured,
    baseUrl: await getBaseUrl(),
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
  const data = await readJson<{ action?: string; baseUrl?: string; key?: string }>(req)
  const action = data?.action

  if (action === 'save') {
    const key = (data?.key ?? '').trim()
    if (!key) return Response.json({ error: '请填写智谱 API Key' }, { status: 400 })
    const url = (data?.baseUrl ?? '').trim()
    if (url && !/^https:\/\//.test(url)) {
      return Response.json({ error: 'baseURL 需以 https:// 开头' }, { status: 400 })
    }
    if (url) await setBaseUrl(url)
    await setApiKey(key)
    return Response.json({ ok: true, ...(await status()) })
  }

  if (action === 'refresh') {
    try {
      const r = await fetchUsageZhipu('30d')
      return Response.json({ ok: true, rows: r.rows.length, ...(await status()) })
    } catch (e) {
      const code = (e as { code?: string }).code
      return Response.json(
        {
          error: code === 'UNCONFIGURED' ? '未配置 API Key' : e instanceof Error ? e.message : '拉取失败',
          ...(await status()),
        },
        { status: 400 },
      )
    }
  }

  if (action === 'clear') {
    await setApiKey('')
    await setBaseUrl('')
    await setLastError('')
    await clearLastData()
    return Response.json({ ok: true, ...(await status()) })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
