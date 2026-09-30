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

export interface SsrUsage {
  rows: UsageRow[]
  start?: string
  end?: string
}

/**
 * SSR 首帧预取指定数据源的用量(首页 Token用量 区块)。
 * 失败 / 未配置 / 拉取异常一律返回 null,由客户端实时拉取兜底,绝不影响页面渲染。
 */
export async function fetchSsrUsage(src: DataSource, range: UsageRange = '30d'): Promise<SsrUsage | null> {
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
    const d = await fetchUsage(range)
    return { rows: d.rows, start: d.start, end: d.end }
  } catch {
    return null
  }
}
