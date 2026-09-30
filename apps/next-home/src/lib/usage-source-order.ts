import { DATA_SOURCES } from '@zx/shared'
import { getDb } from './db'

const META_KEY = 'usage_source_order'

const isDataSource = (k: unknown): k is (typeof DATA_SOURCES)[number] =>
  typeof k === 'string' && (DATA_SOURCES as readonly string[]).includes(k)

/** 规范化:只留合法键、去重,缺省项按默认序补齐 → 永远包含全部数据源 */
export function normalizeOrder(raw: unknown): (typeof DATA_SOURCES)[number][] {
  const input = Array.isArray(raw) ? raw.filter(isDataSource) : []
  const seen = new Set<(typeof DATA_SOURCES)[number]>()
  for (const k of input) seen.add(k)
  const rest = DATA_SOURCES.filter((k) => !seen.has(k))
  return [...seen, ...rest]
}

/** 读取前端 Token用量「数据源展示顺序」(缺省 = 出厂默认序) */
export function getUsageSourceOrder(): (typeof DATA_SOURCES)[number][] {
  try {
    const raw = getDb().getMeta(META_KEY)
    if (!raw) return [...DATA_SOURCES]
    return normalizeOrder(JSON.parse(raw))
  } catch {
    return [...DATA_SOURCES]
  }
}

/** 保存展示顺序(写入前规范化) */
export function setUsageSourceOrder(input: unknown): (typeof DATA_SOURCES)[number][] {
  const order = normalizeOrder(input)
  getDb().setMeta(META_KEY, JSON.stringify(order))
  return order
}