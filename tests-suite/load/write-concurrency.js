/**
 * S3 写并发:埋点 + 留言(唯一 XFF 分发,避免撞 6/min 限流)。
 * 关注:无 5xx、SQLite 无 SQLITE_BUSY 溢出、写入稳定。
 */
import { check } from 'k6'
import { postJson, fakeIp, uniq } from './lib.js'

export const options = {
  scenarios: {
    writes: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 30,
      maxVUs: 100,
    },
  },
  thresholds: {
    // 限流会带来 429,不算失败;只要求不出现 5xx 与连接错误
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{scenario:writes}': ['p(95)<800'],
  },
}

export default function () {
  const ip = fakeIp()
  const t = uniq()

  const track = postJson(
    '/api/track',
    { type: 'project_click', target: `proj-${__VU}`, ref: '/', dwell: 3 },
    { 'x-forwarded-for': ip, 'user-agent': 'k6-load' },
  )
  check(track, { 'track 2xx/429': (r) => r.status === 204 || r.status === 429 })

  const comment = postJson(
    '/api/comments',
    { author: `k6-${__VU}`, body: `负载测试留言 ${t}` },
    { 'x-forwarded-for': ip, 'user-agent': 'k6-load' },
  )
  check(comment, { 'comment 201/400/429': (r) => [201, 400, 429].includes(r.status) })
}
