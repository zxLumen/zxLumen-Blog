import { describe, it, expect } from 'vitest'

import { api, loginAdmin, fakeIp } from './http.mjs'

const cookieValue = (raw) => raw.split('=').slice(1).join('=')

const postComment = (body, { cookies, ip } = {}) =>
  api('/api/comments', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip || fakeIp() },
    cookies,
    body,
  })

describe('留言 API', () => {
  it('校验:昵称 / 正文 / 链接', async () => {
    expect((await postComment({ author: 'a', body: 'x' })).status).toBe(400) // 正文过短
    expect((await postComment({ author: '', body: 'hello' })).status).toBe(400) // 昵称为空
    expect((await postComment({ author: 'a', body: 'hello', author_link: 'ftp://x' })).status).toBe(400)
  })

  it('公开留言 → 201,GET 可见', async () => {
    const body = `hello-${Date.now()}`
    const res = await postComment({ author: '访客A', body })
    expect(res.status).toBe(201)
    const j = await res.json()
    expect(j.comment.id).toBeGreaterThan(0)

    const list = (await (await api('/api/comments?page=1&pageSize=100')).json()).rows
    expect(list.some((r) => r.body === body)).toBe(true)
  })

  it('回复:parent_id 指向存在的留言', async () => {
    const root = (await (await postComment({ author: 'root', body: `root-${Date.now()}` })).json()).comment
    const reply = await postComment({ author: 'reply', body: 'a reply', parent_id: root.id })
    expect(reply.status).toBe(201)
    expect((await reply.json()).comment.parent_id).toBe(root.id)

    // 不存在的父 → 400
    expect((await postComment({ author: 'x', body: 'orphan', parent_id: 999999 })).status).toBe(400)
  })

  it('私密留言:匿名不可见,本人可见且标记 mine', async () => {
    const cid = `cid-${Date.now()}`
    const body = `secret-${Date.now()}`
    const post = await postComment({ author: '私密君', body, visibility: 'private' }, { cookies: { zx_cid: cid } })
    expect(post.status).toBe(201)

    const anon = (await (await api('/api/comments?page=1&pageSize=100')).json()).rows
    expect(anon.some((r) => r.body === body)).toBe(false)

    const mine = (
      await (await api('/api/comments?page=1&pageSize=100', { cookies: { zx_cid: cid } })).json()
    ).rows.find((r) => r.body === body)
    expect(mine).toBeTruthy()
    expect(mine.mine).toBe(true)
    expect('author_cid' in mine).toBe(false)
  })

  it('非站长不得冒用站长昵称 → 403', async () => {
    const { cookie } = await loginAdmin()
    const settings = await (
      await api('/api/admin/settings', { cookies: { zx_admin: cookieValue(cookie) } })
    ).json()
    const res = await postComment({ author: settings.nick, body: 'impersonate attempt' })
    expect(res.status).toBe(403)
  })

  it('限流:同一 IP > 6/min → 429', async () => {
    const ip = fakeIp()
    let last
    for (let i = 0; i < 7; i++) {
      last = await postComment({ author: '限流', body: `rl-${i}` }, { ip })
    }
    expect(last.status).toBe(429)
    const j = await last.json()
    expect(j.error).toBeTruthy()
  })
})
