import type { EventType } from '../schema.js'

/**
 * 上报一次埋点事件(访问 / 项目点击 / 简历下载 / 离开)。
 * 优先用 sendBeacon(不阻塞跳转),否则 fetch keepalive 兜底。
 * 服务端会自行排除站长 / MOCK / 爬虫,并负责发访客 cid。
 */
export function trackEvent(type: EventType, target = '', dwell?: number): void {
  if (typeof window === 'undefined') return
  try {
    const ref = typeof document !== 'undefined' ? document.referrer.slice(0, 500) : ''
    const payload: { type: EventType; target: string; ref: string; dwell?: number } = { type, target, ref }
    if (typeof dwell === 'number' && dwell > 0) payload.dwell = Math.round(dwell)
    const body = JSON.stringify(payload)
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'same-origin',
      keepalive: true,
    })
  } catch {
    /* 埋点失败不影响页面 */
  }
}
