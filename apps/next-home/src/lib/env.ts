import { cookies } from 'next/headers'
import { LIVE_FEATURES, type FeatureId } from '@zx/shared'
import type { Db } from '@zx/shared/server'
import { isAdmin } from './auth'
import { getDb, getTestDb } from './db'

export const ENV_COOKIE = 'zx_env'

/** 是否处于测试模式(必须已登录 admin 才生效) */
export async function isTestMode(): Promise<boolean> {
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
