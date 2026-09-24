/** 统一的内存 TTL 缓存(默认 5 分钟),挂在 globalThis 上以跨 dev 热更新存活 */
export const CACHE_TTL = 5 * 60 * 1000

export function makeTtlCache<T>(globalKey: string, ttlMs = CACHE_TTL) {
  const g = globalThis as unknown as {
    [k: string]: Map<string, { at: number; value: T }> | undefined
  }
  g[globalKey] ??= new Map<string, { at: number; value: T }>()
  const store = g[globalKey] as Map<string, { at: number; value: T }>
  return {
    get(key: string): T | undefined {
      const hit = store.get(key)
      return hit && Date.now() - hit.at < ttlMs ? hit.value : undefined
    },
    set(key: string, value: T): void {
      store.set(key, { at: Date.now(), value })
    },
  }
}
