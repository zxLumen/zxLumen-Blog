/**
 * S8 限流正确性:同一 IP 连发 8 条留言(阈值 6/min),期望出现 429。
 * 通过 Counter 阈值 `count>0` 断言「限流确实生效」。
 */
import { check } from 'k6'
import { Counter } from 'k6/metrics'
import { postJson, uniq } from './lib.js'

const limited = new Counter('zx_rate_limited')
const IP = '10.99.99.99'

export const options = {
  scenarios: {
    rate_limit_probe: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 8,
      maxDuration: '20s',
    },
  },
  thresholds: {
    zx_rate_limited: ['count>0'], // 必须至少触发一次 429
  },
}

export default function () {
  const res = postJson(
    '/api/comments',
    { author: '限流探针', body: `rl-${uniq()}` },
    { 'x-forwarded-for': IP, 'user-agent': 'k6-load' },
  )
  if (res.status === 429) limited.add(1)
  check(res, { 'comment handled [201/400/429]': (r) => [201, 400, 429].includes(r.status) })
}
