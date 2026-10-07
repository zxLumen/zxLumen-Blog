/**
 * S4 聊天流式:并发 /api/chat。
 * 机器人未开放/未配置时返回 404/503,属预期(用宽松阈值);重点看 SSE 是否稳定、不产生 5xx 抖动。
 * 若机器人已配置,建议改走本地 stub/Ollama 上游,避免真实计费。
 */
import { check } from 'k6'
import { postJson, fakeIp, uniq } from './lib.js'

export const options = {
  scenarios: {
    chat: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '5s',
      duration: '30s',
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
  },
}

const OK = [200, 404, 429, 503]

export default function () {
  const res = postJson(
    '/api/chat',
    { message: '你好,简单介绍一下你自己', session_id: `k6-${__VU}-${uniq()}` },
    { 'x-forwarded-for': fakeIp(), 'user-agent': 'k6-load' },
  )
  check(res, { 'chat handled [200/404/429/503]': (r) => OK.includes(r.status) })
}
