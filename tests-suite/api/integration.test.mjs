import { describe, it, expect } from 'vitest'

import { api, fakeIp } from './http.mjs'

describe('集成点(博客侧)', () => {
  it('GET /api/luminari/field:上游不可达时优雅降级为 200 items:[]', async () => {
    const res = await api('/api/luminari/field')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(Array.isArray(j.items)).toBe(true)
  })

  it('GET /api/luminari/chatter:上游不可达时优雅降级为 200 turns:[]', async () => {
    const res = await api('/api/luminari/chatter')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(Array.isArray(j.turns)).toBe(true)
  })

  it('AI 网关:无令牌 → 401(不裸奔)', async () => {
    const post = await api('/api/ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-forwarded-for': fakeIp() },
      body: { model: 'test-model', messages: [{ role: 'user', content: 'ping' }] },
    })
    expect(post.status).toBe(401)

    const models = await api('/api/ai/v1/models')
    expect(models.status).toBe(401)
  })

  it('AI 网关:未知端点 → 404', async () => {
    const res = await api('/api/ai/v1/not-a-real-endpoint')
    expect(res.status).toBe(404)
  })

  it('AI 网关:OPTIONS 预检 → 204 且带 CORS', async () => {
    const res = await api('/api/ai/v1/chat/completions', { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
