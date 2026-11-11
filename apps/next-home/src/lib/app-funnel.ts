import type { AppFunnelRow, ViewerAppRow } from '@zx/shared/server'
import { getDb } from './db'

/**
 * 应用卡片转化漏斗(/apps 排序用)。真正的 SQL 在 `@zx/shared` 的 eventStore:
 * 前台页面与站长后台共用一套口径,不在页面里各写一遍。
 *
 * 口径见 `docs/RESEARCH-douyin-app-platform-2026-11-11.md`:
 *  - impression = app_impression 且 dwell=0
 *  - s3         = dwell≥3 的条数 ÷ impression
 *  - click      = app_click + 命中 bind 的合并事件
 *  - r7         = 7 天内又点过的人 ÷ 点过的人
 *
 * 页面 60 秒缓存一次:19 个 item 的榜单不需要实时,但每请求扫全表会心疼。
 */
const CACHE_MS = 60_000
let cache: { at: number; key: string; value: Record<string, AppFunnelRow> } | null = null

export type { AppFunnelRow, ViewerAppRow }

/** 最近 `days` 天,按应用 id 索引的漏斗数据(没有数据的应用不出现) */
export function getAppFunnel(days = 7): Record<string, AppFunnelRow> {
  const key = `appFunnel|${days}|${process.env.DB_PATH ?? ''}`
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value
  const out: Record<string, AppFunnelRow> = {}
  try {
    for (const row of getDb().appFunnel(days)) out[row.target] = row
  } catch {
    // 老库缺列 / 只读失败:当成没有数据,页面走冷启动逻辑
    return {}
  }
  cache = { at: Date.now(), key, value: out }
  return out
}

/** 当前访客最近 `days` 天点开过的应用,按应用 id 索引 */
export function getViewerAppHistory(cid: string, days = 30): Record<string, ViewerAppRow> {
  if (!cid) return {}
  const out: Record<string, ViewerAppRow> = {}
  try {
    for (const row of getDb().viewerAppHistory(cid, days)) out[row.target] = row
  } catch {
    return {}
  }
  return out
}
