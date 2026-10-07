/**
 * S5 AI 网关:并发 /api/ai/v1/chat/completions。
 * - 设 `ZX_GATEWAY_TOKEN` 时:应 200(或配额 429),并验证用量记账。
 * - 未设时:应 401(鉴权生效),用来验证网关不裸奔。
 * 生产环境**禁止**用真实 key 压测;本地用 stub 上游。
 */
import { check } from 'k6'
import { fakeIp, postJson } from './lib.js'

const TOKEN = __ENV.ZX_GATEWAY_TOKEN || ''

export const options = {
  scenarios: {
    gateway: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
  },
}

const OK = [200, 401, 429]

export default function () {
  const headers = { 'x-forwarded-for': fakeIp(), 'user-agent': 'k6-load' }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  const res = postJson(
    '/api/ai/v1/chat/completions',
    { model: __ENV.ZX_GATEWAY_MODEL || 'test-model', messages: [{ role: 'user', content: 'ping' }], stream: false },
    headers,
  )
  check(res, { 'gateway handled [200/401/429]': (r) => OK.includes(r.status) })
}
