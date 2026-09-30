import { DATA_SOURCES } from '@zx/shared'
import { getDb } from './db'

const META_KEY = 'usage_source_order'
const DEFAULT_KEY = 'usage_default_source'

export type DataSource = (typeof DATA_SOURCES)[number]

const isDataSource = (k: unknown): k is DataSource =>
  typeof k === 'string' && (DATA_SOURCES as readonly string[]).includes(k)

/** 规范化:只留合法键、去重,缺省项按默认序补齐 → 永远包含全部数据源 */
export function normalizeOrder(raw: unknown): DataSource[] {
  const input = Array.isArray(raw) ? raw.filter(isDataSource) : []
  const seen = new Set<DataSource>()
  for (const k of input) seen.add(k)
  const rest = DATA_SOURCES.filter((k) => !seen.has(k))
  return [...seen, ...rest]
}

/** 读取前端 Token用量「数据源展示顺序」(缺省 = 出厂默认序) */
export function getUsageSourceOrder(): DataSource[] {
  try {
    const raw = getDb().getMeta(META_KEY)
    if (!raw) return [...DATA_SOURCES]
    return normalizeOrder(JSON.parse(raw))
  } catch {
    return [...DATA_SOURCES]
  }
}

/** 保存展示顺序(写入前规范化) */
export function setUsageSourceOrder(input: unknown): DataSource[] {
  const order = normalizeOrder(input)
  getDb().setMeta(META_KEY, JSON.stringify(order))
  return order
}

/** 读取「默认数据源」(新访客/无存档时默认打开;缺省 = 出厂首项 DeepSeek) */
export function getUsageDefaultSource(): DataSource {
  try {
    const raw = getDb().getMeta(DEFAULT_KEY)
    return isDataSource(raw) ? raw : DATA_SOURCES[0]
  } catch {
    return DATA_SOURCES[0]
  }
}

/** 保存「默认数据源」(非法值回落出厂首项) */
export function setUsageDefaultSource(input: unknown): DataSource {
  const src = isDataSource(input) ? input : DATA_SOURCES[0]
  getDb().setMeta(DEFAULT_KEY, src)
  return src
}