import type { UsageRow } from '@zx/shared'

/** 非零行(有 tokens / 费用 / 请求数),用于剔除空记录 */
export const isNonZeroRow = (r: UsageRow) =>
  r.inputTokens + r.outputTokens > 0 || (r.cost ?? 0) > 0 || (r.requests ?? 0) > 0

/**
 * 按 key 合并用量行(累加 tokens / requests / cost)。
 * `make` 可自定义首次遇到某 key 时的初始行(如把 ts 归一到当天零点)。
 */
export function aggregateRows(
  rows: UsageRow[],
  keyOf: (r: UsageRow) => string,
  make?: (r: UsageRow) => UsageRow,
): UsageRow[] {
  const map = new Map<string, UsageRow>()
  for (const r of rows) {
    const k = keyOf(r)
    const ex = map.get(k)
    if (ex) {
      ex.inputTokens += r.inputTokens
      ex.outputTokens += r.outputTokens
      ex.cacheHitTokens += r.cacheHitTokens
      ex.requests = (ex.requests ?? 0) + (r.requests ?? 0)
      ex.cost = (ex.cost ?? 0) + (r.cost ?? 0)
    } else {
      map.set(k, make ? make(r) : { ...r })
    }
  }
  return [...map.values()]
}
