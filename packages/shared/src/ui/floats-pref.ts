/**
 * 访客对「主页四周生灵层」的显示偏好。
 *
 * 偏好存在**博客侧 localStorage** —— 主页的显示归主页存;嵌入的应用栏浮层
 * (luminari 生灵应用)是跨子域 iframe,和宿主不同源、不能共享存储,所以由它
 * 通过 `postMessage` 远程设置(协议见 `docs/APP-EMBED.md`)。这样刷新页面也能
 * 同步读到偏好,不会先冒出生灵再消失。
 */

const KEY = 'zx.luminari.floats.hidden'

/** 宿主广播偏好变化的事件名(`LuminariFloats` 订阅) */
export const FLOATS_CHANGE_EVENT = 'zx:floats-change'

export function readFloatsHidden(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const subs = new Set<(hidden: boolean) => void>()

/** 设置偏好并通知订阅者(供宿主收到子应用消息时调用)。 */
export function setFloatsHidden(hidden: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, hidden ? '1' : '0')
  } catch {
    /* 隐私模式 / 超限:忽略,仅本次会话内生效 */
  }
  for (const fn of subs) fn(hidden)
}

export function subscribeFloatsHidden(fn: (hidden: boolean) => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}
