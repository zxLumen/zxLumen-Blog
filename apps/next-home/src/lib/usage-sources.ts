import { getToken, fetchUsage } from './deepseek'
import { getWorkspaces, fetchUsageOpenCodeWs } from './opencode'
import { getApiKey, fetchUsageZhipu } from './zhipu'
import { getDb } from './db'

/** 各数据源是否应在面板显示:已配置 且 近 30 天有数据 */
export interface SourceAvailability {
  deepseek: boolean
  opencode: boolean
  zhipu: boolean
}

async function hasDeepseekData(): Promise<boolean> {
  try {
    const token = await getToken()
    if (token) {
      const d = await fetchUsage('30d')
      if (d.rows.length > 0) return true
    }
  } catch {
    /* fall through to local */
  }
  const local = getDb().listUsage(30)
  return local.length > 0
}

async function hasOpenCodeData(): Promise<boolean> {
  const ws = await getWorkspaces()
  if (ws.length === 0) return false
  const results = await Promise.all(
    ws.map(async (w) => {
      try {
        return (await fetchUsageOpenCodeWs(w, '30d')).rows.length > 0
      } catch {
        return false
      }
    }),
  )
  return results.some(Boolean)
}

async function hasZhipuData(): Promise<boolean> {
  if (!(await getApiKey())) return false
  try {
    return (await fetchUsageZhipu('30d')).rows.length > 0
  } catch {
    return false
  }
}

/** 计算各源可用性(已配置 + 近30天有数据),供面板隐藏空源 */
export async function getSourceAvailability(): Promise<SourceAvailability> {
  const [deepseek, opencode, zhipu] = await Promise.all([
    hasDeepseekData(),
    hasOpenCodeData(),
    hasZhipuData(),
  ])
  return { deepseek, opencode, zhipu }
}
