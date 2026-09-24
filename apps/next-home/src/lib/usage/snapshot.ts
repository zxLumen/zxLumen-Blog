import { getDb } from '../db'

/** 把快照写入 meta 表(JSON) */
export function writeSnapshot(key: string, value: unknown): void {
  getDb().setMeta(key, JSON.stringify(value))
}

/** 读取并解析 meta 表中的快照;缺失/非法返回 null */
export function readSnapshot<T>(key: string): T | null {
  const raw = getDb().getMeta(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
