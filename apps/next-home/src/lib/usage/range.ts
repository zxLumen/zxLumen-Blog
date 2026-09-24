import type { UsageRange } from '@zx/shared'
import { bjDay } from '@zx/shared'

export type { UsageRange }

/** 北京时间 UTC+8 偏移(秒) */
export const TZ = 28800

export interface UsageFilter {
  start?: string
  end?: string
}

export type Month = { year: number; month: number }

export const utcDay = (y: number, m: number, d: number) => {
  const dd = String(d).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** 某月的天数(按 UTC 日历,仅用于边界计算) */
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** 北京日历日 YYYY-MM-DD(相对今天偏移 offsetDays);用于区间边界(平台账单按北京时间对齐) */
export const bjDayOffset = (offsetDays = 0) => bjDay(Date.now() + offsetDays * 86400000)

/** 北京整点标签,如 2026-09-22T10:00:00Z(约定:日期=北京日,小时=北京时,与 opencode 一致) */
export const bjHourLabel = (sec: number) => `${new Date(sec * 1000 + TZ * 1000).toISOString().slice(0, 13)}:00:00Z`

/** 今天/昨天为 hour(分时),其余为 day */
export const granularityOf = (range: UsageRange): 'hour' | 'day' =>
  range === 'today' || range === 'yesterday' ? 'hour' : 'day'

/** 官方 30d 窗口起点(UTC 零点 - 29 天)对应的北京日标签;早于它的区间官方覆盖不到 */
export const apiCoverageStart = () =>
  new Date(Math.floor(Date.now() / 86400000) * 86400000 - 29 * 86400000 + TZ * 1000)
    .toISOString()
    .slice(0, 10)

/** 计算指定 range 的闭区间日期窗口(北京日,YYYY-MM-DD) */
export function windowOf(range: UsageRange, filter?: UsageFilter): { start: string; end: string } {
  const today = bjDayOffset(0)
  const lastMonthBounds = (): { start: string; end: string } => {
    const y = Number(today.slice(0, 4))
    const m = Number(today.slice(5, 7))
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
    return { start: utcDay(prev.y, prev.m, 1), end: utcDay(prev.y, prev.m, daysIn(prev.y, prev.m)) }
  }
  switch (range) {
    case 'today':
      return { start: today, end: today }
    case 'yesterday':
      return { start: bjDayOffset(-1), end: bjDayOffset(-1) }
    case '7d':
      return { start: bjDayOffset(-6), end: today }
    case '30d':
      return { start: bjDayOffset(-29), end: today }
    case 'month':
      return { start: today.slice(0, 7) + '-01', end: today }
    case 'lastmonth':
      return lastMonthBounds()
    case 'custom': {
      const start = filter?.start || today
      const end = filter?.end || today
      return { start: start <= end ? start : end, end: start <= end ? end : start }
    }
  }
}

/** start 到 end 之间需要拉取的月(升序,上限 12 个月) */
export function monthsIn(start: string, end: string): Month[] {
  const out: Month[] = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const endY = Number(end.slice(0, 4))
  const endM = Number(end.slice(5, 7))
  while (y < endY || (y === endY && m <= endM)) {
    if (out.length >= 12) break
    out.push({ year: y, month: m })
    if (m === 12) {
      y += 1
      m = 1
    } else {
      m += 1
    }
  }
  if (out.length === 0) out.push({ year: endY, month: endM })
  return out
}
