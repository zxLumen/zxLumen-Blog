/**
 * S6 Soak:中等负载持续跑,观察 RSS / 堆 / 事件循环是否随时间劣化。
 * 时长与并发可用环境变量覆盖:`ZX_SOAK_DURATION`(默认 30m)、`ZX_SOAK_VUS`(默认 30)。
 * 运行期间另开终端采样进程内存:`ps -o rss= -p <pid>`。
 */
import { check, sleep } from 'k6'
import { get } from './lib.js'

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: Number(__ENV.ZX_SOAK_VUS || 30),
      duration: __ENV.ZX_SOAK_DURATION || '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:soak}': ['p(95)<400'],
  },
}

export default function () {
  check(get('/'), { 'home 200': (r) => r.status === 200 })
  check(get('/api/comments?page=1&pageSize=10'), { 'comments 200': (r) => r.status === 200 })
  check(get('/api/usage/sources'), { 'usage/sources 200': (r) => r.status === 200 })
  sleep(1.5)
}
