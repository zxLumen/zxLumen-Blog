import { PRICING, estimateCost } from '../../pricing.js'
import type { UsageRow } from '../../schema.js'
import type { DataSource, Range } from '../../usage-sel.js'
import type { FeatureId } from '../../features.js'

// 未收录进 PRICING 的模型(Go / 智谱等)按模型名哈希取一个稳定颜色,
// 避免全部回落 accent(蓝)导致饼图/图例无法区分。
const MODEL_PALETTE = [
  '#4dabf7', '#ff6b6b', '#51cf66', '#fcc419', '#cc5de8', '#ff922b',
  '#20c997', '#f06595', '#845ef7', '#22b8cf', '#94d82d', '#e599f7',
]

const hashStr = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const modelColor = (model: string) =>
  PRICING.find((p) => p.model === model)?.color ?? MODEL_PALETTE[hashStr(model) % MODEL_PALETTE.length]

export const modelLabel = (model: string) =>
  PRICING.find((p) => p.model === model)?.label ?? model

export const rowCost = (r: UsageRow) =>
  typeof r.cost === 'number' ? r.cost : estimateCost(r).total

export const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
  { key: 'month', label: '本月' },
  { key: 'lastmonth', label: '上月' },
  { key: 'custom', label: '自定义' },
]

export const rangeLabel = (r: Range) => RANGES.find((x) => x.key === r)?.label ?? r

// 所有平台同一套模板:今天/昨天分时(hour),其余区间按天(day)
export const SOURCES: { key: DataSource; label: string; hint: string; feature?: FeatureId }[] = [
  { key: 'deepseek', label: 'DeepSeek', hint: '官方数据源 · 今天/昨天分时' },
  { key: 'opencode', label: 'OpenCode', hint: '官方数据源 · 今天/昨天分时', feature: 'usage-opencode' },
  { key: 'zhipu', label: '智谱', hint: '按模型 token · 区间汇总', feature: 'usage-zhipu' },
]

export const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const mergeUnique = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]))

export interface GoQuotaWindow {
  percent: number
  status?: string
  resetsAt?: string
}
export interface GoQuota {
  rolling?: GoQuotaWindow
  weekly?: GoQuotaWindow
  monthly?: GoQuotaWindow
}
export interface ZhipuQuotaLimit {
  type?: string
  unit?: number
  percentage?: number
  usage?: number
  currentValue?: number
  remaining?: number
  nextResetTime?: number
}
export interface ZhipuQuota {
  limits: ZhipuQuotaLimit[]
  level?: string
}
