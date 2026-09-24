import type { UsageRow } from '@zx/shared'

/** 各用量数据源拉取结果的公共结构 */
export interface PlatformUsageBase {
  rows: UsageRow[]
  models: string[]
  currency: string
  start: string
  end: string
  granularity?: 'hour' | 'day'
}
