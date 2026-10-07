import { describe, it, expect } from 'vitest'

import { api, setCookie, loginAdmin } from './http.mjs'

const cookieValue = (raw) => raw.split('=').slice(1).join('=')

describe('管理员鉴权', () => {
  it('未登录访问 /api/admin/settings → 401', async () => {
    const res = await api('/api/admin/settings')
    expect(res.status).toBe(401)
  })

  it('错误密码 → 401 且不下发会话', async () => {
    const { res, cookie } = await loginAdmin('definitely-wrong')
    expect(res.status).toBe(401)
    expect(cookie).toBe('')
  })

  it('正确密码 → 200 且下发 zx_admin', async () => {
    const { res, cookie } = await loginAdmin()
    expect(res.status).toBe(200)
    expect(cookie).toMatch(/^zx_admin=/)
  })

  it('带会话 cookie 访问受保护接口 → 200', async () => {
    const { cookie } = await loginAdmin()
    const res = await api('/api/admin/settings', { cookies: { zx_admin: cookieValue(cookie) } })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(typeof j.nick).toBe('string')
  })

  it('篡改会话 cookie → 401', async () => {
    const { cookie } = await loginAdmin()
    const v = cookieValue(cookie)
    const bad = v.slice(0, -1) + (v.endsWith('a') ? 'b' : 'a')
    const res = await api('/api/admin/settings', { cookies: { zx_admin: bad } })
    expect(res.status).toBe(401)
  })

  it('伪造过期会话 → 401', async () => {
    const res = await api('/api/admin/settings', { cookies: { zx_admin: '1.abcdef' } })
    expect(res.status).toBe(401)
  })

  it('MOCK 设置/清除仅站长可用', async () => {
    const unauth = await api('/api/admin/mock', { method: 'POST', body: { cid: 'x' } })
    expect(unauth.status).toBe(401)

    const { cookie } = await loginAdmin()
    const res = await api('/api/admin/mock', {
      method: 'POST',
      body: { cid: '' },
      cookies: { zx_admin: cookieValue(cookie) },
    })
    expect(res.status).toBe(200)
  })

  it('登录响应带 Set-Cookie 可被解析', async () => {
    const { res } = await loginAdmin()
    const sc = setCookie(res, 'zx_admin')
    expect(sc).toMatch(/^zx_admin=\d+\./)
  })
})
