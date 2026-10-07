/**
 * S1 稳态读:0→100 VU 爬升、保持、回落。首页 + 留言 + 健康。
 * 阈值:p95 < 300ms,失败率 < 1%。
 */
import { check, sleep } from 'k6'
import { get } from './lib.js'

export const options = {
  scenarios: {
    steady_read: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:steady_read}': ['p(95)<300'],
  },
}

export default function () {
  check(get('/'), { 'home 200': (r) => r.status === 200 })
  check(get('/api/comments?page=1&pageSize=20'), { 'comments 200': (r) => r.status === 200 })
  check(get('/api/health'), { 'health 200': (r) => r.status === 200 })
  sleep(1)
}
