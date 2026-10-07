/**
 * k6 压测公共库(在 k6 运行时执行,不依赖 Node)。
 * 目标地址由 `ZX_LOAD_BASE` 注入(run.mjs 会设为本地临时服务)。
 */
import http from 'k6/http'

export const BASE = __ENV.ZX_LOAD_BASE || 'http://127.0.0.1:3197'

/** 唯一 X-Forwarded-For:隔离内存限流桶(每 IP 独立计数) */
export function fakeIp() {
  return `10.20.${__VU % 250}.${(__ITER || 0) % 250}`
}

/** 随机 token,避免命中埋点 2s 防抖 */
export function uniq() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function get(path, headers = {}) {
  return http.get(`${BASE}${path}`, { headers })
}

export function postJson(path, body, headers = {}) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** 统一的基础阈值(可按场景覆盖/追加) */
export const BASE_THRESHOLDS = {
  http_req_failed: ['rate<0.01'],
}
