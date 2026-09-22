import { cookies } from 'next/headers'
import { LIVE_FEATURES, type FeatureId } from '@zx/shared'
import type { Db } from '@zx/shared/server'
import { isAdmin } from './auth'
import { getDb, getTestDb } from './db'

export const ENV_COOKIE = 'zx_env'

/**
 * 测试模式是否可用(整站开关的前置条件)。
 *
 * 生产环境(NODE_ENV=production)**默认禁用整站测试模式**:线上产物永远只有一个
 * 生产环境,试验在本地做。确需在生产临时开通时,显式设 `ALLOW_TEST_MODE=1`。
 */
export function testModeAvailable(): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  return process.env.ALLOW_TEST_MODE === '1'
}

/** 是否处于测试模式(需管理员 + 测试模式可用 + zx_env=test) */
export async function isTestMode(): Promise<boolean> {
  if (!testModeAvailable()) return false
  if (!(await isAdmin())) return false
  const store = await cookies()
  return store.get(ENV_COOKIE)?.value === 'test'
}

/** 当前生效的数据库:测试模式用独立测试库,否则用线上库 */
export async function getActiveDb(): Promise<Db> {
  return (await isTestMode()) ? getTestDb() : getDb()
}

/** 服务端功能门控:测试模式恒开,正式模式仅放行 LIVE_FEATURES */
export async function featureOn(id: FeatureId): Promise<boolean> {
  return (await isTestMode()) || LIVE_FEATURES.includes(id)
}
