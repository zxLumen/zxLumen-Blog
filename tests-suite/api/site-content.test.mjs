import { describe, it, expect } from 'vitest'

import { api, loginAdmin } from './http.mjs'

const cookieValue = (raw) => raw.split('=').slice(1).join('=')

describe('站点内容 /api/admin/site-content', () => {
  it('未登录 GET → 401', async () => {
    const res = await api('/api/admin/site-content')
    expect(res.status).toBe(401)
  })

  it('未登录 POST → 401', async () => {
    const res = await api('/api/admin/site-content', { method: 'POST', body: { partial: {}, rev: 'x' } })
    expect(res.status).toBe(401)
  })

  it('登录后 GET → 200,含 content 与 rev', async () => {
    const { cookie } = await loginAdmin()
    const res = await api('/api/admin/site-content', { cookies: { zx_admin: cookieValue(cookie) } })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.rev).toBeTypeOf('string')
    expect(j.rev.length).toBe(16)
    expect(j.content).toBeTruthy()
    expect(j.content.PROFILE).toBeTruthy()
  })

  it('错误的 rev → 409', async () => {
    const { cookie } = await loginAdmin()
    const res = await api('/api/admin/site-content', {
      method: 'POST',
      body: { partial: { PROFILE: { title: 'x' } }, rev: 'deadbeefdeadbeef' },
      cookies: { zx_admin: cookieValue(cookie) },
    })
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.rev).toBeTypeOf('string')
  })

  it('保存后 GET 能读回改动,rev 变化', async () => {
    const { cookie } = await loginAdmin()
    const before = await (
      await api('/api/admin/site-content', { cookies: { zx_admin: cookieValue(cookie) } })
    ).json()

    const save = await api('/api/admin/site-content', {
      method: 'POST',
      body: { partial: { PROFILE: { statusLine: '测试状态行' } }, rev: before.rev },
      cookies: { zx_admin: cookieValue(cookie) },
    })
    expect(save.status).toBe(200)
    const saved = await save.json()
    expect(saved.rev).not.toBe(before.rev)

    const after = await (
      await api('/api/admin/site-content', { cookies: { zx_admin: cookieValue(cookie) } })
    ).json()
    expect(after.content.PROFILE.statusLine).toBe('测试状态行')
    expect(after.rev).toBe(saved.rev)
  })
})
