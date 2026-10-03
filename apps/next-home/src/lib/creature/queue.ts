// 生物生成的**排队闸**(进程内)。
//
// 为什么要排队而不是直接 429:
//   单次生成要 30~80s,而本机是纯 IO 等待(SSE),并发开到 12 路 CPU 毫无压力 ——
//   真正的稀缺资源是上游模型的配额与本月的钱。以前「超过 4 个在途就直接 429」
//   是在**替上游挡它从没挡过的东西**:实测上游一次都没回过 429(/tmp 日志为 0),
//   那些 429 全是我们自己打的,纯属误伤。所以改成「有空位就开跑,没空位就排队」。
//
// 为什么不做「同一描述合并成一次调用」(single-flight):
//   这个 demo 要展示的恰恰是「同一句话每次生成的都不一样」,合并就看不到多样性了。
//   代价(同一句重复生成会各烧一份 token)由 `budget.ts` 的日预算兜底。
//
// 进程内状态:重启即清。对 lab 完全可以接受;真正的日配额在 `budget.ts`(落库)。

/** 同时在途的生成数上限 */
export const MAX_INFLIGHT = 12

/** 排队最长等待;超过就让客户端自己重试,不占着 socket */
const MAX_QUEUE_WAIT_MS = 90_000

/** 排队中的任务若这么久没人来领,直接丢弃(客户端可能已经关页面了) */
const QUEUE_TTL_MS = 45_000

/** 已完成任务留多久供轮询取走 */
const DONE_TTL_MS = 10 * 60_000

/** ETA 种子:还没有耗时样本时先按 45s 估 */
const ETA_SEED_MS = 45_000

const ETA_WINDOW = 10

export interface QueueStats {
  /** 正在跑 */
  running: number
  /** 排队中 */
  waiting: number
}

export type JobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: string
  descr: string
  state: JobState
  /** 排队位置(1 起);不在排队时为 0 */
  position: number
  /** 预计还要等多久(ms);不在排队时为 0 */
  etaMs: number
  createdAt: number
  startedAt: number
  finishedAt: number
  /** 跑完之后的结果 / 错误,供轮询取 */
  result?: unknown
  error?: { message: string; status: number }
}

interface Waiter {
  resolve: () => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  jobId: string
}

// 挂 globalThis:dev 下模块可能被热重载多次,否则会多出几个互不知情的信号量
const g = globalThis as unknown as { __zxCreatureQueue?: QueueImpl }

class QueueImpl {
  private running = 0
  private waiters: Waiter[] = []
  private jobs = new Map<string, Job>()
  /** 近几次真实耗时,用于估 ETA */
  private samples: number[] = []

  stats(): QueueStats {
    return { running: this.running, waiting: this.waiters.length }
  }

  /** 单次生成的耗时均值(样本不足时回落到种子值) */
  private avgMs(): number {
    if (!this.samples.length) return ETA_SEED_MS
    const sum = this.samples.reduce((a, b) => a + b, 0)
    return sum / this.samples.length
  }

  private noteDuration(ms: number) {
    this.samples.push(ms)
    if (this.samples.length > ETA_WINDOW) this.samples.shift()
  }

  private sweep() {
    const now = Date.now()
    for (const [id, j] of this.jobs) {
      const age = now - j.finishedAt
      const stale =
        (j.state === 'queued' && now - j.createdAt > QUEUE_TTL_MS) ||
        ((j.state === 'done' || j.state === 'error' || j.state === 'cancelled') &&
          j.finishedAt > 0 &&
          age > DONE_TTL_MS)
      if (stale) {
        this.jobs.delete(id)
        // 还没被领走的排队任务超时丢弃:把它的等待者也一并撤掉
        const i = this.waiters.findIndex((w) => w.jobId === id)
        if (i >= 0) {
          const w = this.waiters[i]
          this.waiters.splice(i, 1)
          clearTimeout(w.timer)
          w.reject(new Error('QUEUE_TIMEOUT'))
        }
      }
    }
  }

  /**
   * 取号:有空位立刻返回 `now`;否则排进 FIFO 队列。
   * 返回 `now` 表示**调用方负责跑完并调用 `done`**,返回 promise 则等轮到自己。
   * @param id 本次任务的 id(同时用作排队时的凭据)
   * @returns `null` = 立即开跑;否则是一个「轮到自己就 resolve」的 promise
   */
  acquire(id: string, descr = ''): Promise<void> | null {
    this.sweep()
    if (this.running < MAX_INFLIGHT) {
      this.running++
      this.jobs.set(id, {
        id,
        descr,
        state: 'running',
        position: 0,
        etaMs: 0,
        createdAt: Date.now(),
        startedAt: Date.now(),
        finishedAt: 0,
      })
      return null
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.jobId === id)
        if (i >= 0) this.waiters.splice(i, 1)
        const j = this.jobs.get(id)
        if (j) j.state = 'error'
        reject(new Error('QUEUE_TIMEOUT'))
      }, MAX_QUEUE_WAIT_MS)
      this.waiters.push({ resolve, reject, timer, jobId: id })
      this.jobs.set(id, {
        id,
        descr,
        state: 'queued',
        position: this.waiters.length,
        etaMs: this.waiters.length * this.avgMs(),
        createdAt: Date.now(),
        startedAt: 0,
        finishedAt: 0,
      })
    })
  }

  /** 交还槽位:直接把槽位「传递」给下一个等待者(不递减 running),避免竞态 */
  release() {
    const w = this.waiters.shift()
    if (!w) {
      this.running = Math.max(0, this.running - 1)
      return
    }
    clearTimeout(w.timer)
    const j = this.jobs.get(w.jobId)
    if (j) {
      j.state = 'running'
      j.position = 0
      j.etaMs = 0
      j.startedAt = Date.now()
    }
    w.resolve()
  }

  /** 跑完:记录耗时样本 + 落终态 */
  finish(id: string, state: 'done' | 'error' | 'cancelled', payload?: Job['result'], err?: Job['error']) {
    const j = this.jobs.get(id)
    const now = Date.now()
    if (j) {
      if (j.startedAt) this.noteDuration(now - j.startedAt)
      j.state = state
      j.finishedAt = now
      j.result = payload
      j.error = err
    }
  }

  /** 客户端主动取消:还在排队就直接摘掉(不烧 token),已开跑则标记 */
  cancel(id: string): boolean {
    const j = this.jobs.get(id)
    if (!j) return false
    if (j.state === 'queued') {
      const i = this.waiters.findIndex((w) => w.jobId === id)
      if (i >= 0) {
        const w = this.waiters[i]
        this.waiters.splice(i, 1)
        clearTimeout(w.timer)
        w.reject(new Error('CANCELLED'))
      }
      j.state = 'cancelled'
      j.finishedAt = Date.now()
      return true
    }
    if (j.state === 'running') {
      j.state = 'cancelled'
      j.finishedAt = Date.now()
      return true
    }
    return false
  }

  get(id: string): Job | undefined {
    this.sweep()
    return this.jobs.get(id)
  }

  /** 供测试/调试:重置全部状态 */
  reset() {
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('RESET'))
    }
    this.waiters = []
    this.jobs.clear()
    this.samples = []
    this.running = 0
  }
}

export function queue(): QueueImpl {
  if (!g.__zxCreatureQueue) g.__zxCreatureQueue = new QueueImpl()
  return g.__zxCreatureQueue
}