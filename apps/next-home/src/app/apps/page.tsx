import type { AppItem } from '@zx/shared'
import { getVisibleApps } from '@/lib/app-config'
import { getAppFunnel, getViewerAppHistory, type AppFunnelRow } from '@/lib/app-funnel'
import { effectiveCid } from '@/lib/clientid'
import { AppFeed, type FeedCard } from '@/components/AppFeed'
import './apps.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '应用 · zxLumen',
  description: '一张卡 = 一个能立刻用起来的小应用。按点击率和复访率排,不按我喜欢排。',
}

/**
 * 排序权重(与 `docs/RESEARCH-douyin-app-platform-2026-11-11.md` 的 v0 一致):
 * score = 0.5*ctr + 0.3*r7 + 0.2*fresh
 *  - ctr  = 点开 / 曝光
 *  - r7   = 7 天内又点过的人占比
 *  - fresh= 还没被曝光过(0 次)记 1,否则 0 —— 没有「更新时间」字段,用曝光量代替新鲜度
 * 另外:曝光 <200 的卡进「冷启动池」给固定加权,保证新卡也能拿到曝光(抖音的赛马逻辑,
 * 只是把 5000 次曝光缩到 200 次)。全部为 0 数据时退化成 admin 配的顺序。
 */
const W_CTR = 0.5
const W_R7 = 0.3
const W_FRESH = 0.2
const COLD_IMPRESSIONS = 200
const COLD_BONUS = 0.15
/** 探索位:固定插在这个下标,推一张访客 30 天没打开过的应用 */
const EXPLORE_SLOT = 3

/** events.day 是北京日字符串,直接按字符串算天数差 */
function daysAgo(day: string): number | null {
  if (!day) return null
  const t = Date.parse(`${day}T00:00:00+08:00`)
  if (!Number.isFinite(t)) return null
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  const n = Math.round(
    (Date.parse(`${today}T00:00:00+08:00`) - t) / 86400_000,
  )
  return Math.max(0, n)
}

function statOf(
  funnel: Record<string, AppFunnelRow>,
  ids: (string | undefined)[],
): Omit<AppFunnelRow, 'target'> {
  let clicks = 0
  let impressions = 0
  let r7 = 0
  const seen = new Set<string>()
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const row = funnel[id]
    if (!row) continue
    clicks += row.clicks
    if (id === ids[0]) {
      impressions = row.impressions
      r7 = row.r7
    }
  }
  return {
    impressions,
    s3: ids[0] ? funnel[ids[0]]?.s3 ?? 0 : 0,
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0,
    s3Rate: 0,
    r7,
  }
}

export default async function AppsPage() {
  const apps = getVisibleApps()
  const funnel = getAppFunnel(7)
  const cid = await effectiveCid()
  const history = cid ? getViewerAppHistory(cid, 30) : {}

  // 1) 打分(同分保持 admin 顺序:sort 在现代 V8 里稳定)
  const scored = apps.map((app) => {
    const stat = statOf(funnel, [app.id, app.bind])
    const fresh = stat.impressions === 0 ? 1 : 0
    const cold = stat.impressions < COLD_IMPRESSIONS
    return {
      app,
      stat,
      cold,
      score: W_CTR * stat.ctr + W_R7 * stat.r7 + W_FRESH * fresh + (cold ? COLD_BONUS : 0),
    }
  })
  scored.sort((a, b) => b.score - a.score)

  // 2) 探索位:按当前访客 30 天记录,挑一张没打开过的插到第 4 张
  const ordered = [...scored]
  const pickIndex = pickExploration(ordered, history)
  const picked = pickIndex > 0 && ordered.length > EXPLORE_SLOT
  if (picked) {
    const [p] = ordered.splice(pickIndex, 1)
    ordered.splice(EXPLORE_SLOT, 0, p)
  }

  const cards: FeedCard[] = ordered.map(({ app, stat }) => {
    const mine = history[app.id] ?? (app.bind ? history[app.bind] : undefined)
    return {
      app: app as AppItem,
      ctr: stat.ctr,
      r7: stat.r7,
      impressions: stat.impressions,
      opens: mine?.opens ?? 0,
      lastAgo: mine ? daysAgo(mine.lastDay) : null,
      cold: stat.impressions < COLD_IMPRESSIONS,
    }
  })

  // 角标只在真有数据时出现:没有打开记录就不给「最常打开」,不硬编
  const maxOpens = Math.max(0, ...cards.map((c) => c.opens))
  if (maxOpens > 0) {
    const top = cards.findIndex((c) => c.opens === maxOpens)
    if (top >= 0) cards[top].badge = 'most'
  }
  if (picked) cards[EXPLORE_SLOT].badge = 'explore'

  return <AppFeed cards={cards} />
}

/** 返回要插到探索位的下标;0 = 不用动(第一张本来就没看过) */
function pickExploration(
  list: { app: AppItem }[],
  history: Record<string, { opens: number; lastDay: string }>,
): number {
  const seen = (a: AppItem) => Boolean(history[a.id] || (a.bind && history[a.bind]))
  const never = list.findIndex((x) => !seen(x.app))
  if (never > 0) return never
  if (never === 0) return 0
  // 全都看过了:挑最久没打开的那张
  let oldest = 0
  let day = ''
  list.forEach((x, i) => {
    const d = history[x.app.id]?.lastDay ?? (x.app.bind ? history[x.app.bind]?.lastDay : '') ?? ''
    if (!day || (d && d < day)) {
      day = d
      oldest = i
    }
  })
  return oldest
}
