// 问候语定时生成器:服务启动时预热当前时段,此后每 60s 检查一次,
// 跨时段(05/11/14/22 北京)或跨天自动重生成并落库。生成不再由访客触发。
import { refreshGreetings } from './greeting'

const INTERVAL_MS = 60_000

let started = false

export function startGreetingScheduler(): void {
  if (started) return
  started = true

  const run = (why: string) => {
    refreshGreetings()
      .then((did) => {
        if (did) console.log(`[greeting] scheduler generated (${why})`)
      })
      .catch((e) => {
        console.warn('[greeting] scheduler failed:', e instanceof Error ? e.message : String(e))
      })
  }

  // 启动预热(延后 1s,不阻塞 server ready)
  const boot = setTimeout(() => run('startup'), 1000)
  if (typeof boot.unref === 'function') boot.unref()

  const timer = setInterval(() => run('tick'), INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
}
