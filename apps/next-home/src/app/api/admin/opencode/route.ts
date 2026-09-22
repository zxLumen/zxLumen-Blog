import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  getConsoleUrl,
  setConsoleUrl,
  getServiceKey,
  setServiceKey,
  getLastError,
  setLastError,
  getSnapshotStatus,
  clearLastData,
  fetchUsageOpenCode,
} from '@/lib/opencode'

export const dynamic = 'force-dynamic'

async function status() {
  const configured = !!(await getServiceKey())
  return {
    configured,
    consoleUrl: await getConsoleUrl(),
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
  const data = await readJson<{ action?: string; consoleUrl?: string; key?: string }>(req)
  const action = data?.action

  if (action === 'save') {
    const key = (data?.key ?? '').trim()
    if (!key) return Response.json({ error: '请填写 Console 服务账号 API Key(oc_sk_…)' }, { status: 400 })
    if (!key.startsWith('oc_sk_')) {
      return Response.json(
        { error: '这不是服务账号 Key:需在 Console 创建(oc_sk_ 开头);网页令牌 / sk- API Key 会被官方拒绝' },
        { status: 400 },
      )
    }
    const url = (data?.consoleUrl ?? '').trim()
    if (url) await setConsoleUrl(url.replace(/\/$/, ''))
    await setServiceKey(key)
    return Response.json({ ok: true, ...(await status()) })
  }

  if (action === 'refresh') {
    try {
      const r = await fetchUsageOpenCode('30d')
      return Response.json({ ok: true, rows: r.rows.length, granularity: r.granularity, ...(await status()) })
    } catch (e) {
      const code = (e as { code?: string }).code
      return Response.json(
        {
          error:
            code === 'UNCONFIGURED'
              ? '未配置服务账号 Key'
              : code === 'INVALID_KEY'
                ? '密钥无效或无权限'
                : e instanceof Error
                  ? e.message
                  : '拉取失败',
          ...(await status()),
        },
        { status: 400 },
      )
    }
  }

  if (action === 'clear') {
    await setServiceKey('')
    await setConsoleUrl('')
    await setLastError('')
    await clearLastData()
    return Response.json({ ok: true, ...(await status()) })
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}