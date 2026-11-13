import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import { getAppsOrderRev, getStoredApps, reorderVisibleApps } from '@/lib/app-config'

export const dynamic = 'force-dynamic'

/**
 * 站长在**首页应用栏**直接拖拽排序时调这里(admin 面板里拖仍然走整表 POST)。
 *
 * 差异:应用栏手上只有可见项,而 `apps_config` 里还存着垃圾箱条目。
 * 所以这里只按 id 重排可见项,垃圾箱原地不动 —— 不会把删掉的应用顺手弄没。
 *
 *   POST { ids: string[] }  → { ok, apps, rev }   ids = 拖完之后的全部可见 id
 *   409                      → 可见项集合已变(别的标签页加了/删了应用),让前端刷新
 */
export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<{ ids?: unknown }>(req).catch(() => null)
  if (!body || !Array.isArray(body.ids)) {
    return Response.json({ error: '缺少 ids 数组' }, { status: 400 })
  }
  const ids = body.ids.filter((x): x is string => typeof x === 'string')
  const apps = reorderVisibleApps(ids)
  if (!apps) {
    return Response.json(
      { error: '应用列表已变化,请刷新后再拖', apps: getStoredApps(), rev: getAppsOrderRev() },
      { status: 409 },
    )
  }
  return Response.json({ ok: true, apps, rev: getAppsOrderRev() })
}
