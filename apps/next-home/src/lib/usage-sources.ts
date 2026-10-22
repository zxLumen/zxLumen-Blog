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
import { ensureLogsScheduler } from './opencode-logs'
import {
  getApiKey,
  fetchUsageZhipu,
  getLastRows as zhipuLastRows,
  getLastFailure as zhipuLastFailure,
} from './zhipu'
import { hasMinimaxData, ensureMinimaxScheduler } from './minimax'
import { getGatewayUsageRows } from './ai-gateway'
import { getDb } from './db'
import { makeSwrCache } from './usage/cache'
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

/** 可用性探测缓存 TTL(过期后仍先用旧值,后台刷新) */
const AVAIL_TTL = 60_000

/** 冷启动(进程刚起、缓存为空)最多等上游多久;超时用「已配置」快速兜底 */
const COLD_WAIT_MS = 1_200

/** 非凭证类失败的探测宽限(期间直接用快照,不重复请求) */
const FAIL_GRACE_MS = 10 * 60_000

const AVAIL_KEY = '__all'
const availCache = makeSwrCache<SourceAvailability>('__usageAvailCache', AVAIL_TTL)

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

/** AI 网关:近 30 天有「仍存在的应用」的用量即在面板显示(已删除应用的用量不计) */
async function hasGatewayData(): Promise<boolean> {
  try {
    return getGatewayUsageRows('30d').rows.length > 0
  } catch {
    return false
  }
}

/** 实时计算各源可用性(会打上游,不要在请求临界路径上直接 await) */
async function computeAvailability(): Promise<SourceAvailability> {
  const [deepseek, opencode, zhipu, minimax, gateway, errors] = await Promise.all([
    hasDeepseekData(),
    hasOpenCodeData(),
    hasZhipuData(),
    hasMinimaxData(),
    hasGatewayData(),
    collectErrors(),
  ])
  return { deepseek, opencode, zhipu, minimax, gateway, errors }
}

/**
 * 冷启动超时的快速兜底:只看「是否已配置」,不打上游。
 * 后台刷新仍会继续,下一轮请求即可拿到真实可用性。
 */
async function configuredOnly(): Promise<SourceAvailability> {
  try {
    const [token, ws, zhipuKey] = await Promise.all([getToken(), getWorkspaces(), getApiKey()])
    return {
      deepseek: !!token,
      opencode: ws.length > 0,
      zhipu: !!zhipuKey,
      minimax: hasMinimaxData(),
      gateway: getGatewayUsageRows('30d').rows.length > 0,
      errors: {},
    }
  } catch {
    return { deepseek: false, opencode: false, zhipu: false, minimax: false, gateway: false, errors: {} }
  }
}

/**
 * 计算各源可用性(已配置 + 近30天有数据),供面板隐藏空源。
 *
 * 首页速度优先:结果缓存 60s,且 **stale-while-revalidate** —— 过期后先返回旧值,
 * 上游探测在后台跑。这样即使某个用量接口卡住 8–15s,首页也不会跟着卡。
 */
export async function getSourceAvailability(): Promise<SourceAvailability> {
  // 顺带确保自建小时采样在跑(幂等;首页有访问即可,不依赖 admin 操作)
  ensureHourlyScheduler()
  // 顺带确保控制台推理日志的后台自动同步在跑(未配置 Cookie 时为空操作)
  ensureLogsScheduler()
  // 顺带确保 MiniMax 额度自动同步在跑(未配置订阅 Key 时为空操作)
  ensureMinimaxScheduler()
  try {
    return await availCache.get(AVAIL_KEY, computeAvailability, { maxWaitMs: COLD_WAIT_MS })
  } catch {
    // 冷启动等超时:先用配置兜底,别让探针/访客等上游
    return configuredOnly()
  }
}
