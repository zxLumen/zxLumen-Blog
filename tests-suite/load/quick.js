/**
 * S0 quick:CI / 本地最小冒烟(几秒),用于验证压测链路可用。
 *   k6 run --env ZX_LOAD_BASE=http://127.0.0.1:3197 tests-suite/load/quick.js
 */
import { check, sleep } from 'k6'
import { get } from './lib.js'

export const options = {
  vus: 5,
  duration: '5s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
}

export default function () {
  check(get('/api/health'), { 'health 200': (r) => r.status === 200 })
  check(get('/'), { 'home 200': (r) => r.status === 200 })
  check(get('/api/comments?page=1&pageSize=20'), { 'comments 200': (r) => r.status === 200 })
  sleep(0.5)
}
