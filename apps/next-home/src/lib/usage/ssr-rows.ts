import type { DataSource, UsageRow } from '@zx/shared'
import { fetchUsage, type UsageRange } from '../deepseek'
import {
  getWorkspaces,
  fetchUsageOpenCodeWs,
  mergeUsageOpenCode,
  type OcWorkspace,
  type PlatformUsageOpenCode,
} from '../opencode'
import { fetchUsageZhipu } from '../zhipu'
import { getMinimaxUsage } from '../minimax'
import { getGatewayUsageRows } from '../ai-gateway'
import { makeSwrCache } from './cache'

export interface SsrUsage {
  rows: UsageRow[]
  start?: string
  end?: string
}

/** 首帧用量结果缓存(5 分钟,stale-while-revalidate) */
const ssrCache = makeSwrCache<SsrUsage | null>('__ssrUsageCache', 5 * 60 * 1000)

/**
 * SSR 首帧预取指定数据源的用量(首页 Token用量 区块)。
 * 失败 / 未配置 / 拉取异常 / 超时一律返回 null,由客户端实时拉取兜底,绝不影响页面渲染。
 */
export async function fetchSsrUsage(
  src: DataSource,
  range: UsageRange = '30d',
  opts?: { maxWaitMs?: number },
): Promise<SsrUsage | null> {
  // 与可用性同样的 stale-while-revalidate 策略:过期先返回上次结果、后台刷新,
  // 避免 5 分钟缓存到期的那一次请求正好被探针撞上(每次慢 ~1.2s)。
  try {
    return await ssrCache.get(`${src}:${range}`, () => loadSsrUsage(src, range), {
      maxWaitMs: opts?.maxWaitMs,
    })
  } catch {
    // 冷启动等超时:首屏先不显示用量,客户端会实时拉取;后台刷新继续填充缓存
    return null
  }
}

async function loadSsrUsage(src: DataSource, range: UsageRange): Promise<SsrUsage | null> {
  try {
    if (src === 'opencode') {
      const ws = await getWorkspaces()
      if (ws.length === 0) return null
      const parts = await Promise.all(
        ws.map(async (w): Promise<{ ws: OcWorkspace; data: PlatformUsageOpenCode } | null> => {
          try {
            return { ws: w, data: await fetchUsageOpenCodeWs(w, range) }
          } catch {
            return null
          }
        }),
      )
      const live = parts.filter((p): p is { ws: OcWorkspace; data: PlatformUsageOpenCode } => p !== null)
      if (live.length === 0) return null
      const merged = mergeUsageOpenCode(live)
      return { rows: merged.rows, start: merged.start, end: merged.end }
    }
    if (src === 'zhipu') {
      const d = await fetchUsageZhipu(range)
      return { rows: d.rows, start: d.start, end: d.end }
    }
    if (src === 'minimax') {
      // 书签推送快照,本地读,零延迟
      const d = getMinimaxUsage(range)
      if (d.rows.length === 0) return null
      return { rows: d.rows, start: d.start, end: d.end }
    }
    if (src === 'gateway') {
      // 自建网关用量,读本地表
      const d = getGatewayUsageRows(range)
      return { rows: d.rows, start: d.start, end: d.end }
    }
    const d = await fetchUsage(range)
    return { rows: d.rows, start: d.start, end: d.end }
  } catch {
    return null
  }
}
