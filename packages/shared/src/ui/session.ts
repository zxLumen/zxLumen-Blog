/**
 * 客户端会话 ID:一个标签页一个,存 sessionStorage(关闭标签页即失效)。
 * 与访客 cid(cookie,长期)配合使用:
 *  - cid  = 是谁(UV / r7 口径)
 *  - sid  = 这一次打开(曝光 / s3 / 会话内行为)
 * 取不到 sessionStorage(隐私模式 / 禁用)时退化为模块内内存值,至少本次页面生命周期一致。
 */
const KEY = 'zx_sid'
const RE = /^[a-z0-9-]{8,64}$/i

let memo = ''

function randomId(): string {
  try {
    const buf = new Uint8Array(16)
    crypto.getRandomValues(buf)
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // 极端环境没有 crypto:时间戳 + 随机数,只求本次会话不重复
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  if (memo) return memo
  try {
    const saved = window.sessionStorage.getItem(KEY)
    if (saved && RE.test(saved)) {
      memo = saved
      return memo
    }
  } catch {
    /* 隐私模式:读不了就不读 */
  }
  memo = randomId()
  try {
    window.sessionStorage.setItem(KEY, memo)
  } catch {
    /* 写不了就只在内存里用 */
  }
  return memo
}
