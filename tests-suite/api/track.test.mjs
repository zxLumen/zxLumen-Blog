import { describe, it, expect } from 'vitest'

import { api, fakeIp } from './http.mjs'

const send = (body, headers = {}) =>
  api('/api/track', {
    method: 'POST',
    headers: { 'x-forwarded-for': fakeIp(), 'user-agent': 'vitest-browser', ...headers },
    body,
  })

describe('埋点上报', () => {
  it('合法 visit → 204', async () => {
    expect((await send({ type: 'visit', target: '/' })).status).toBe(204)
  })

  it('爬虫 UA 静默丢弃 → 204', async () => {
    const res = await send({ type: 'visit' }, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' })
    expect(res.status).toBe(204)
  })

  it('非法 type 视为 visit,不报错 → 204', async () => {
    expect((await send({ type: '__not_a_type__' })).status).toBe(204)
  })

  it('超长 target 被截断,不报错 → 204', async () => {
    expect((await send({ type: 'project_click', target: 'x'.repeat(5000) })).status).toBe(204)
  })
})
