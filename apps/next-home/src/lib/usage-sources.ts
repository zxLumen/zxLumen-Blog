import { getToken, fetchUsage, getLastRows, getLastError as deepseekLastError } from './deepseek'
import {
  getWorkspaces,
  fetchUsageOpenCodeWs,
  hasSnapshotRows,
  getLastFailure,
  ensureHourlyScheduler,
  getLastError as ocLastError,
  type SourceFailure,
} from './opencode'
import {
  getApiKey,
  fetchUsageZhipu,
  getLastRows as zhipuLastRows,
  getLastFailure as zhipuLastFailure,
} from './zhipu'
import { getDb } from './db'
import { makeTtlCache } from './usage/cache'
import type { SourceAvailability } from '@zx/shared'

/**
 * 各数据源是否应在面板显示:已配置 且 近 30 天有数据(**含上次成功快照**)。
 *
 * 首页速度优先:
 * 1. 结果进程内缓存 60s(挂 globalThis,dev 热更新存活)——连续刷新/并发不重复打上游;
 * 2. 已判定失败的源短时间内**不再发网络请求**,直接用快照判定:key 无效(401)/ 未配置
 *    永久短路(重试也还是被拒,换 key 后由 admin 保存/成功拉取清除),其它失败(含 403
 *    无权限)宽限 {@link FAIL_GRACE_MS} 后自动重试 —— Console 侧补权限即可自愈;
 * 3. 实时拉取失败也回退快照,数据源不会整块从面板消失,而是显示上次数据 + 报错角标。
 */
export type { SourceAvailability }

/** 可用性探测缓存 TTL */
const AVAIL_TTL = 60_000

/** 非凭证类失败的探测宽限(期间直接用快照,不重复请求) */
const FAIL_GRACE_MS = 10 * 60_000

const AVAIL_KEY = '__all'
const availCache = makeTtlCache<SourceAvailability>('__usageAvailCache', AVAIL_TTL)

/** admin 改动配置(key / URL / workspace)后调用:立即失效缓存,不必等 TTL */
export function invalidateAvailability() {
  availCache.del(AVAIL_KEY)
}

/** 是否应跳过实时探测(见文件头说明) */
function shouldSkipProbe(f: SourceFailure | null): boolean {
  if (!f) return false
  // key 无效 / 未配置:重试也还是被拒(换 key 后由 admin 保存或成功拉取清除)
  if (f.code === 'INVALID_KEY' || f.code === 'UNCONFIGURED') return true
  // 其它失败(含 403 无权限):宽限期内不重复请求,到点自动重试 → Console 侧改权限后可自愈
  return Date.now() - f.at < FAIL_GRACE_MS
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
  if (getDb().listUsage(30).length > 0) return true
  // 平台拉取失败时,平台自己的快照也算数(与 /api/usage 的回退口径一致)
  return !!(await getLastRows('30d'))
}

async function hasOpenCodeData(): Promise<boolean> {
  const ws = await getWorkspaces()
  if (ws.length === 0) return false
  // 已知失败(含 key 失效):重复请求官方 API 只会再失败一次,直接看快照
  if (shouldSkipProbe(await getLastFailure())) return hasSnapshotRows()
  const results = await Promise.all(
    ws.map(async (w) => {
      try {
        return (await fetchUsageOpenCodeWs(w, '30d')).rows.length > 0
      } catch {
        return false
      }
    }),
  )
  if (results.some(Boolean)) return true
  return hasSnapshotRows()
}

async function hasZhipuData(): Promise<boolean> {
  if (!(await getApiKey())) return false
  if (shouldSkipProbe(await zhipuLastFailure())) return !!(await zhipuLastRows())
  try {
    if ((await fetchUsageZhipu('30d')).rows.length > 0) return true
  } catch {
    /* fall through to snapshot */
  }
  return !!(await zhipuLastRows())
}

/** 各源最近一次失败信息(仅用于面板 tab 上的报错角标,不影响 tab 是否显示) */
async function collectErrors(): Promise<NonNullable<SourceAvailability['errors']>> {
  const [ds, ocFail, ocErr, zpFail] = await Promise.all([
    deepseekLastError(),
    getLastFailure(),
    ocLastError(),
    zhipuLastFailure(),
  ])
  const errors: NonNullable<SourceAvailability['errors']> = {}
  if (ds) errors.deepseek = String(ds)
  if (ocFail?.message) errors.opencode = ocFail.message
  else if (ocErr) errors.opencode = ocErr
  if (zpFail?.message) errors.zhipu = zpFail.message
  return errors
}

/** 计算各源可用性(已配置 + 近30天有数据),供面板隐藏空源;结果缓存 60s */
export async function getSourceAvailability(): Promise<SourceAvailability> {
  // 顺带确保自建小时采样在跑(幂等;首页有访问即可,不依赖 admin 操作)
  ensureHourlyScheduler()
  const hit = availCache.get(AVAIL_KEY)
  if (hit) return hit
  const [deepseek, opencode, zhipu, errors] = await Promise.all([
    hasDeepseekData(),
    hasOpenCodeData(),
    hasZhipuData(),
    collectErrors(),
  ])
  const result: SourceAvailability = { deepseek, opencode, zhipu, errors }
  availCache.set(AVAIL_KEY, result)
  return result
}
