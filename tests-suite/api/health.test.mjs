import { describe, it, expect } from 'vitest'

import { api, METRICS_TOKEN } from './http.mjs'

describe('健康与可观测', () => {
  it('GET /api/health → 200 ok', async () => {
    const res = await api('/api/health')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.status).toBe('ok')
  })

  it('GET /api/metrics:无 token 403,带 token 200 text/plain', async () => {
    const no = await api('/api/metrics')
    expect(no.status).toBe(403)

    const yes = await api('/api/metrics', { headers: { 'x-metrics-token': METRICS_TOKEN } })
    expect(yes.status).toBe(200)
    expect(yes.headers.get('content-type')).toContain('text/plain')
    expect((await yes.text()).length).toBeGreaterThan(0)
  })

  it('GET /api/usage/sources → 200', async () => {
    const res = await api('/api/usage/sources')
    expect(res.status).toBe(200)
  })

  it('GET /api/chat/config → 200 且不下发密钥', async () => {
    const res = await api('/api/chat/config')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toHaveProperty('enabled')
    expect(j.apiKey).toBeUndefined()
    expect(j.embedApiKey).toBeUndefined()
  })
})
