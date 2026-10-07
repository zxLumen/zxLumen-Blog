/** L2 接口测试的 HTTP 小工具:基于全局 fetch,手动管理 cookie。 */

// 注意:变量名不能叫 BASE_URL —— Vite/Vitest 会注入同名的 process.env,导致空串。
export const BASE = process.env.ZX_TEST_BASE_URL || 'http://127.0.0.1:3199'
export const METRICS_TOKEN = process.env.METRICS_TOKEN || 'test-metrics'
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-pass'

/**
 * 发起请求。
 * @param {string} path 以 `/` 开头
 * @param {{method?:string, body?:unknown, headers?:Record<string,string>, cookies?:Record<string,string>, raw?:boolean}} [opts]
 */
export async function api(path, opts = {}) {
  const { method = 'GET', body, headers = {}, cookies = {} } = opts
  const h = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  const cookieStr = Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  if (cookieStr) h.cookie = cookieStr
  return fetch(BASE + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
}

/** 从响应里取某个 Set-Cookie 的 `name=value`(取不到返回 '') */
export function setCookie(res, name) {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  for (const c of all) {
    const pair = c.split(';')[0]
    const i = pair.indexOf('=')
    if (i > 0 && pair.slice(0, i) === name) return pair
  }
  return ''
}

/** 隔离内存限流的每个用例:给一个唯一的 XFF(服务端按它分桶) */
let seq = 0
export function fakeIp() {
  seq += 1
  return `10.9.${Math.floor(seq / 250)}.${seq % 250}`
}

/** 以站长身份登录,返回 `{ cookie }`(及原始响应,便于断言失败分支) */
export async function loginAdmin(password = ADMIN_PASSWORD) {
  const res = await api('/api/admin/login', {
    method: 'POST',
    body: { password },
    headers: { 'x-forwarded-for': fakeIp() },
  })
  return { res, cookie: setCookie(res, 'zx_admin') }
}
