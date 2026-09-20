'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CommentRow, PagedComments } from '../schema.js'
import { fmtDateTime } from '../format.js'
import { Pagination } from './Pagination.js'

async function loadPageData(page: number, pageSize: number): Promise<PagedComments> {
  const res = await fetch(`/api/admin/comments?page=${page}&pageSize=${pageSize}`, {
    credentials: 'same-origin',
  })
  if (res.status === 401) throw new Error('unauthorized')
  if (!res.ok) throw new Error(`加载失败 (${res.status})`)
  return (await res.json()) as PagedComments
}

export function AdminPanel() {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [comments, setComments] = useState<CommentRow[]>([])
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [nick, setNick] = useState('')
  const [nickBusy, setNickBusy] = useState(false)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const [total, setTotal] = useState(0)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)

  const loadPage = useCallback(async (p: number, size: number) => {
    setLoading(true)
    try {
      const d = await loadPageData(p, size)
      setComments(d.rows ?? [])
      setTotal(d.total ?? 0)
      setListPage(d.page ?? 1)
      setPageSize(d.pageSize ?? size)
      setTotalPages(d.totalPages ?? 1)
      setAuthed(true)
    } catch {
      setAuthed(false)
    } finally {
      setLoading(false)
      setReady(true)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    const sres = await fetch('/api/admin/settings', { credentials: 'same-origin' })
    if (sres.ok) {
      const s = (await sres.json()) as { nick?: string }
      setNick(s.nick ?? '')
    }
  }, [])

  async function saveNick() {
    setNickBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ nick }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(d.error || '保存失败')
      setMsg({ kind: 'ok', text: '站长昵称已保存,留言将自动使用' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setNickBusy(false)
    }
  }

  useEffect(() => {
    void (async () => {
      await loadPage(1, 5)
      await loadSettings()
    })()
  }, [loadPage, loadSettings])

  async function savePassword() {
    if (newPw !== newPw2) return setMsg({ kind: 'err', text: '两次输入的新密码不一致' })
    if (newPw.length < 4) return setMsg({ kind: 'err', text: '新密码至少 4 位' })
    setPwBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ current: curPw, next: newPw }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(d.error || '修改失败')
      setCurPw('')
      setNewPw('')
      setNewPw2('')
      setMsg({ kind: 'ok', text: '密码已更新(存于数据库,优先于环境变量)' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '修改失败' })
    } finally {
      setPwBusy(false)
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      })
      if (!res.ok) throw new Error('密码错误')
      setPassword('')
      // 重新加载以让侧边栏出现 admin 入口
      if (typeof window !== 'undefined') window.location.reload()
      return
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '登录失败' })
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
    setAuthed(false)
    setComments([])
    setMsg({ kind: 'ok', text: '已退出站长登录' })
  }

  async function onDelete(id: number) {
    if (!confirm(`删除留言 #${id}(含其回复)?`)) return
    try {
      const res = await fetch('/api/admin/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('删除失败')
      await loadPage(listPage, pageSize)
      setMsg({ kind: 'ok', text: `已删除 #${id}` })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '删除失败' })
    }
  }

  if (!ready) {
    return (
      <div className="zx-container" style={{ paddingBlock: '4rem' }}>
        <p className="zx-muted zx-mono">loading…</p>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="zx-container" style={{ maxWidth: 460, paddingBlock: '4rem' }}>
        <h1 className="zx-mono" style={{ fontSize: '1.4rem', marginBottom: '1rem' }}>
          🔒 ADMIN
        </h1>
        <form className="zx-form" onSubmit={(e) => void login(e)}>
          <div className="zx-field">
            <label className="zx-label" htmlFor="pw">
              admin password
            </label>
            <input
              id="pw"
              type="password"
              className="zx-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <button className="zx-btn zx-btn-primary" type="submit" disabled={busy}>
            {busy ? '验证中…' : '进入'}
          </button>
          {msg && <div className={`zx-msg ${msg.kind}`}>{msg.text}</div>}
        </form>
      </div>
    )
  }

  const tops = comments.filter((c) => !c.parent_id).slice().reverse()
  const repliesOf = (id: number) => comments.filter((c) => c.parent_id === id)

  return (
    <div className="zx-container" style={{ paddingBlock: '2.5rem' }}>
      <div className="zx-sec-head">
        <span className="zx-sec-tag">// ADMIN</span>
        <h1 className="zx-sec-title">留言管理</h1>
        <button className="zx-btn zx-btn-sm zx-btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => void logout()}>
          退出登录
        </button>
      </div>
      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          站长昵称 <span>留言/回复时自动使用</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            style={{ maxWidth: 240 }}
            value={nick}
            maxLength={32}
            placeholder="站长昵称"
            onChange={(e) => setNick(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            type="button"
            onClick={() => void saveNick()}
            disabled={nickBusy}
          >
            {nickBusy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          修改密码 <span>存于数据库,优先于环境变量</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 180 }}
            value={curPw}
            placeholder="当前密码"
            onChange={(e) => setCurPw(e.target.value)}
          />
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 180 }}
            value={newPw}
            placeholder="新密码"
            onChange={(e) => setNewPw(e.target.value)}
          />
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 180 }}
            value={newPw2}
            placeholder="确认新密码"
            onChange={(e) => setNewPw2(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            type="button"
            onClick={() => void savePassword()}
            disabled={pwBusy}
          >
            {pwBusy ? '保存中…' : '更新密码'}
          </button>
        </div>
      </div>

      {msg && <div className={`zx-msg ${msg.kind}`}>{msg.text}</div>}

      <p className="zx-muted zx-mono" style={{ fontSize: '0.75rem' }}>
        // {total} 条留言(含私密与回复){loading ? ' · 加载中…' : ''} · 已登录状态在所有页面生效
      </p>

      <div className="zx-comments">
        {tops.length === 0 && <div className="zx-c-empty">暂无留言</div>}
        {tops.map((c) => (
          <div className="zx-comment" key={c.id}>
            <div className="zx-c-head">
              <span className="zx-c-author">{c.author}</span>
              {!!c.is_admin && <span className="zx-admin-tag">站长</span>}
              {c.visibility === 'private' && <span className="zx-private-tag">仅站长可见</span>}
              <span className="zx-c-time">
                #{c.id} · {fmtDateTime(c.created_at)}
              </span>
              {c.ip && <span className="zx-c-time">ip {c.ip}</span>}
              <button
                className="zx-btn zx-btn-sm zx-btn-ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => void onDelete(c.id)}
              >
                delete
              </button>
            </div>
            <div className="zx-c-body">{c.body}</div>

            {repliesOf(c.id).map((r) => (
              <div className="zx-comment zx-reply" key={r.id}>
                <div className="zx-c-head">
                  <span className="zx-c-author">↳ {r.author}</span>
                  {!!r.is_admin && <span className="zx-admin-tag">站长</span>}
                  {r.visibility === 'private' && <span className="zx-private-tag">仅站长可见</span>}
                  <span className="zx-c-time">
                    #{r.id} · {fmtDateTime(r.created_at)}
                  </span>
                  <button
                    className="zx-btn zx-btn-sm zx-btn-ghost"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => void onDelete(r.id)}
                  >
                    delete
                  </button>
                </div>
                <div className="zx-c-body">{r.body}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <Pagination
        page={listPage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        disabled={loading}
        onPage={(p) => void loadPage(p, pageSize)}
        onPageSize={(s) => void loadPage(1, s)}
      />
    </div>
  )
}
