/**
 * S2 峰值突刺:找拐点与首个 5xx 出现点(不做严格通过阈值,观察为主)。
 */
import { check, sleep } from 'k6'
import { get } from './lib.js'

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },
        { duration: '15s', target: 300 },
        { duration: '45s', target: 300 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  // 只设「不整体崩」的下限,拐点由 summary 判定
  thresholds: {
    http_req_failed: ['rate<0.10'],
  },
}

export default function () {
  const r = get('/')
  check(r, { 'status < 500': (x) => x.status < 500 })
  if (r.status >= 500) {
    console.log(`5xx: ${r.status} @ ${r.url}`)
  }
  sleep(0.3)
}
