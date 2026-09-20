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

  const [cEmail, setCEmail] = useState('')
  const [cWechat, setCWechat] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [contactBusy, setContactBusy] = useState(false)
  const [qrUrl, setQrUrl] = useState('/wechat.png')
  const [qrBusy, setQrBusy] = useState(false)

  interface DsStatus {
    configured?: boolean
    exp?: number | null
    expired?: boolean | null
    lastSync?: string | null
    syncKey?: string
    lastError?: string | null
  }
  const [ds, setDs] = useState<DsStatus | null>(null)
  const [dsToken, setDsToken] = useState('')
  const [dsBusy, setDsBusy] = useState(false)

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
      const s = (await sres.json()) as {
        nick?: string
        contacts?: { email?: string; wechat?: string; phone?: string }
      }
      setNick(s.nick ?? '')
      setCEmail(s.contacts?.email ?? '')
      setCWechat(s.contacts?.wechat ?? '')
      setCPhone(s.contacts?.phone ?? '')
    }
    const qres = await fetch('/api/admin/wechat-qr', { credentials: 'same-origin' })
    if (qres.ok) {
      const q = (await qres.json()) as { hasQr?: boolean; ver?: string | null }
      setQrUrl(q.hasQr ? `/api/contact/wechat-qr?v=${q.ver}` : '/wechat.png')
    }
    const dres = await fetch('/api/admin/deepseek', { credentials: 'same-origin' })
    if (dres.ok) setDs((await dres.json()) as DsStatus)
  }, [])

  async function loadDeepseek() {
    const res = await fetch('/api/admin/deepseek', { credentials: 'same-origin' })
    if (res.ok) setDs((await res.json()) as DsStatus)
  }

  async function dsAction(action: 'save' | 'refresh' | 'rotate' | 'clear', token?: string) {
    setDsBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/deepseek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, token }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(d.error || '操作失败')
      if (action === 'save') setDsToken('')
      await loadDeepseek()
      setMsg({ kind: 'ok', text: action === 'refresh' ? '已刷新(令牌有效)' : '操作成功' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '操作失败' })
    } finally {
      setDsBusy(false)
    }
  }

  function copyBookmarklet() {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const key = ds?.syncKey ?? ''
    const code = `javascript:(async()=>{try{const j=JSON.parse(localStorage.getItem('userToken')||'{}');const t=j.value||j;const r=await fetch('${origin}/api/deepseek/token',{method:'POST',headers:{'Content-Type':'text/plain','X-Sync-Key':'${key}'},body:JSON.stringify({token:t})});alert(r.ok?'✅ 已同步 DeepSeek 令牌到主页':'❌ 同步失败 '+r.status)}catch(e){alert('同步失败: '+e)}})()`
    navigator.clipboard
      .writeText(code)
      .then(() => setMsg({ kind: 'ok', text: '同步书签已复制(在 DeepSeek 用量页点它)' }))
      .catch(() => setMsg({ kind: 'err', text: '复制失败,请手动复制' }))
  }

  async function uploadQr(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setMsg({ kind: 'err', text: '仅支持 PNG/JPEG/WebP' })
      return
    }
    if (file.size > 800 * 1024) {
      setMsg({ kind: 'err', text: '图片需 ≤ 800KB' })
      return
    }
    setQrBusy(true)
    setMsg(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('读取文件失败'))
        r.readAsDataURL(file)
      })
      const res = await fetch('/api/admin/wechat-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ dataUrl }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string; url?: string }
      if (!res.ok) throw new Error(d.error || '上传失败')
      setQrUrl(`${d.url}&t=${Date.now()}`)
      setMsg({ kind: 'ok', text: '二维码已更新,前台即时生效' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '上传失败' })
    } finally {
      setQrBusy(false)
    }
  }

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

  async function saveContacts() {
    setContactBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ contacts: { email: cEmail, wechat: cWechat, phone: cPhone } }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(d.error || '保存失败')
      setMsg({ kind: 'ok', text: '联系方式已保存(前台立即生效)' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setContactBusy(false)
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
          联系方式 <span>前台「关于」与页脚展示;电话不显示号码</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            style={{ maxWidth: 220 }}
            value={cEmail}
            placeholder="邮箱"
            onChange={(e) => setCEmail(e.target.value)}
          />
          <input
            className="zx-input"
            style={{ maxWidth: 180 }}
            value={cWechat}
            placeholder="微信号"
            onChange={(e) => setCWechat(e.target.value)}
          />
          <input
            className="zx-input"
            style={{ maxWidth: 180 }}
            value={cPhone}
            placeholder="电话(仅用于拨号/复制,不显示)"
            onChange={(e) => setCPhone(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            type="button"
            onClick={() => void saveContacts()}
            disabled={contactBusy}
          >
            {contactBusy ? '保存中…' : '保存联系方式'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
          <img
            src={qrUrl}
            alt="微信二维码预览"
            style={{ width: 120, borderRadius: 8, border: '1px solid var(--line)', display: 'block' }}
          />
          <label className="zx-btn zx-btn-sm" style={{ cursor: 'pointer' }}>
            {qrBusy ? '上传中…' : '上传 / 更新二维码'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              disabled={qrBusy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadQr(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <span className="zx-muted zx-mono" style={{ fontSize: '0.7rem' }}>
            PNG/JPEG/WebP · ≤800KB · 上传即生效
          </span>
        </div>
      </div>

      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          DeepSeek 用量 <span>平台私有接口 · 需登录会话令牌</span>
        </h3>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', margin: '0 0 0.6rem' }}>
          状态:
          {ds?.configured ? (ds.expired ? '已过期(需重新同步)' : '已配置') : '未配置'}
          {ds?.exp ? ` · 有效期至 ${new Date(ds.exp).toLocaleString()}` : ''}
          {ds?.lastSync ? ` · 最近同步 ${ds.lastSync.slice(0, 19).replace('T', ' ')}` : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="zx-btn zx-btn-sm zx-btn-primary" disabled={dsBusy} onClick={copyBookmarklet}>
            复制同步书签
          </button>
          <button
            className="zx-btn zx-btn-sm"
            disabled={dsBusy || !ds?.configured}
            onClick={() => void dsAction('refresh')}
          >
            验证 / 刷新
          </button>
          <button
            className="zx-btn zx-btn-sm zx-btn-ghost"
            disabled={dsBusy}
            onClick={() => {
              if (confirm('轮换同步密钥?旧书签将失效')) void dsAction('rotate')
            }}
          >
            轮换密钥
          </button>
          <button
            className="zx-btn zx-btn-sm zx-btn-ghost"
            disabled={dsBusy || !ds?.configured}
            onClick={() => void dsAction('clear')}
          >
            清除令牌
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            style={{ maxWidth: 340 }}
            placeholder="或手动粘贴 userToken"
            value={dsToken}
            onChange={(e) => setDsToken(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm"
            disabled={dsBusy || !dsToken}
            onClick={() => void dsAction('save', dsToken)}
          >
            保存令牌
          </button>
        </div>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.68rem', marginTop: '0.6rem', lineHeight: 1.6 }}>
          用法:登录 <span className="zx-accent">platform.deepseek.com/usage</span> → 点「复制同步书签」得到的书签
          (或 F12 复制 <span className="zx-accent">localStorage.userToken.value</span> 粘贴保存)。令牌仅存服务器,不下发前端。
        </p>
        {ds?.lastError && <div className="zx-msg err">{ds.lastError}</div>}
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
