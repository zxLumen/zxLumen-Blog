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
    del(key: string): void {
      store.delete(key)
    },
  }
}

/** 给 promise 加等待上限:超时 reject,底层 promise 继续执行(用于后台刷新) */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * stale-while-revalidate 缓存:过期不阻塞请求,先返回旧值、后台刷新。
 *
 * - 新鲜 → 直接返回
 * - 已过期且有旧值 → 立即返回旧值,同时后台刷新(同 key 并发去重)
 * - 冷启动(无旧值) → 等待刷新,可用 maxWaitMs 限制等待;超时抛错由调用方兜底
 * - 刷新失败保留旧值,不污染缓存
 *
 * 首页 SSR 用它避免「上游接口一抖 → 页面跟着卡」,探针(3s 超时)也就不会误判。
 */
export function makeSwrCache<T>(globalKey: string, ttlMs = CACHE_TTL) {
  type Entry = { at: number; value: T }
  const g = globalThis as unknown as {
    [k: string]: { store: Map<string, Entry>; pending: Map<string, Promise<T>> } | undefined
  }
  g[globalKey] ??= { store: new Map<string, Entry>(), pending: new Map<string, Promise<T>>() }
  const { store, pending } = g[globalKey]!

  const refresh = (key: string, load: () => Promise<T>): Promise<T> => {
    const running = pending.get(key)
    if (running) return running
    const p = load().then((value) => {
      store.set(key, { at: Date.now(), value })
      return value
    })
    pending.set(key, p)
    // 独立挂一个 handler:失败时不产生 unhandledRejection,并清掉 pending
    void p.catch(() => {}).finally(() => pending.delete(key))
    return p
  }

  return {
    get(key: string, load: () => Promise<T>, opts?: { maxWaitMs?: number }): Promise<T> {
      const hit = store.get(key)
      if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value)
      if (hit) {
        // 过期:后台刷新,页面立即用旧值
        void refresh(key, load).catch(() => {})
        return Promise.resolve(hit.value)
      }
      const p = refresh(key, load)
      return opts?.maxWaitMs ? withTimeout(p, opts.maxWaitMs) : p
    },
    peek(key: string): T | undefined {
      return store.get(key)?.value
    },
    del(key: string): void {
      store.delete(key)
      pending.delete(key)
    },
  }
}
