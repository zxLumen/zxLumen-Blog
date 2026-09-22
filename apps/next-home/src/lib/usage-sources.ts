import { getToken, fetchUsage } from './deepseek'
import { getServiceKey, fetchUsageOpenCode } from './opencode'
import { getApiKey, fetchUsageZhipu } from './zhipu'
import { getActiveDb, featureOn } from './env'

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
  const local = (await getActiveDb()).listUsage(30)
  return local.length > 0
}

async function hasOpenCodeData(): Promise<boolean> {
  if (!(await getServiceKey())) return false
  try {
    return (await fetchUsageOpenCode('30d')).rows.length > 0
  } catch {
    return false
  }
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
    featureOn('usage-opencode').then((on) => (on ? hasOpenCodeData() : false)),
    featureOn('usage-zhipu').then((on) => (on ? hasZhipuData() : false)),
  ])
  return { deepseek, opencode, zhipu }
}
