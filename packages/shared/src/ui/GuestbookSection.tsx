'use client'

import { useEffect, useState } from 'react'
import type { CommentRow } from '../schema.js'
import { fmtDateTime } from '../format.js'
import { Section } from './Section.js'

export interface NewComment {
  author: string
  author_link: string
  body: string
  visibility: 'public' | 'private'
  parent_id?: number | null
}

interface GuestbookProps {
  initial?: CommentRow[]
  /** 自定义提交(默认 POST /api/comments) */
  submit?: (input: NewComment) => Promise<CommentRow> | CommentRow
  /** 已登录 admin:可看私密、可删除、回复为站长 */
  isAdmin?: boolean
  /** API 前缀 */
  apiBase?: string
  /** 服务端预填昵称(cookie 或站长昵称) */
  initialAuthor?: string
}

const NICK_COOKIE = 'zx_nick'

function readCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : ''
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`
}

async function defaultSubmit(apiBase: string, input: NewComment): Promise<CommentRow> {
  const res = await fetch(`${apiBase}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || `提交失败 (${res.status})`)
  }
  const data = (await res.json()) as { comment: CommentRow }
  return data.comment
}

export function GuestbookSection({
  initial = [],
  submit,
  isAdmin = false,
  apiBase: apiBaseProp = '/api',
  initialAuthor = '',
}: GuestbookProps) {
  const apiBase = apiBaseProp.replace(/\/$/, '')
  const [items, setItems] = useState<CommentRow[]>(initial)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // 顶层表单(昵称预填)
  const [author, setAuthor] = useState(initialAuthor)
  const [link, setLink] = useState('')
  const [body, setBody] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [busy, setBusy] = useState(false)

  // 回复
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [rAuthor, setRAuthor] = useState(initialAuthor)
  const [rBody, setRBody] = useState('')
  const [rPrivate, setRPrivate] = useState(false)
  const [rBusy, setRBusy] = useState(false)

  // 无服务端预填时,从 cookie 兜底恢复
  useEffect(() => {
    if (!initialAuthor) {
      const n = readCookie(NICK_COOKIE)
      if (n) {
        setAuthor((a) => a || n)
        setRAuthor((a) => a || n)
      }
    }
  }, [initialAuthor])

  function rememberNick(name: string) {
    setAuthor(name)
    writeCookie(NICK_COOKIE, name)
  }

  const visible = items.filter((c) => c.visibility === 'public' || isAdmin)
  const byId = new Map<number, CommentRow>(visible.map((c) => [c.id, c]))

  // 沿 parent_id 向上找根节点(祖先不可见时就地为止),只做单层缩进
  function rootOf(c: CommentRow): CommentRow {
    let cur = c
    const seen = new Set<number>()
    while (cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = byId.get(cur.parent_id) as CommentRow
    }
    return cur
  }

  const roots = visible.filter((c) => rootOf(c).id === c.id).slice().reverse()
  const repliesFor = (id: number) => visible.filter((c) => c.id !== id && rootOf(c).id === id)
  const targetOf = (c: CommentRow) => (c.parent_id ? byId.get(c.parent_id) : null)
  const canShow = (c: CommentRow) => c.visibility === 'public' || isAdmin

  async function send(input: NewComment): Promise<CommentRow> {
    return submit ? await submit(input) : await defaultSubmit(apiBase, input)
  }

  async function onSubmitTop(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const a = author.trim()
    const b = body.trim()
    if (a.length < 1 || a.length > 32) return setMsg({ kind: 'err', text: '昵称需 1-32 字' })
    if (b.length < 2 || b.length > 500) return setMsg({ kind: 'err', text: '留言需 2-500 字' })

    setBusy(true)
    try {
      const saved = await send({
        author: a,
        author_link: link.trim(),
        body: b,
        visibility: isPrivate ? 'private' : 'public',
        parent_id: null,
      })
      if (canShow(saved)) setItems((prev) => [...prev, saved])
      rememberNick(a)
      setMsg({
        kind: 'ok',
        text: saved.visibility === 'private' ? '已发送,仅站长可见' : '已发布,感谢留言!',
      })
      setLink('')
      setBody('')
      setIsPrivate(false)
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '提交失败,请稍后重试' })
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitReply(e: React.FormEvent, parent: CommentRow) {
    e.preventDefault()
    const a = rAuthor.trim()
    const b = rBody.trim()
    if (a.length < 1 || a.length > 32) return setMsg({ kind: 'err', text: '昵称需 1-32 字' })
    if (b.length < 2 || b.length > 500) return setMsg({ kind: 'err', text: '回复需 2-500 字' })

    setRBusy(true)
    try {
      const saved = await send({
        author: a,
        author_link: '',
        body: b,
        visibility: rPrivate ? 'private' : 'public',
        parent_id: parent.id,
      })
      if (canShow(saved)) setItems((prev) => [...prev, saved])
      rememberNick(a)
      setReplyTo(null)
      setRBody('')
      setRPrivate(false)
      setMsg({ kind: 'ok', text: '回复成功' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '回复失败' })
    } finally {
      setRBusy(false)
    }
  }

  async function onDelete(id: number) {
    if (!confirm(`删除留言 #${id}(含其全部回复)?`)) return
    try {
      const res = await fetch(`${apiBase}/admin/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '删除失败')
      // 本地移除该节点及其整棵子树
      const removed = new Set<number>([id])
      let changed = true
      while (changed) {
        changed = false
        for (const c of items) {
          if (c.parent_id && removed.has(c.parent_id) && !removed.has(c.id)) {
            removed.add(c.id)
            changed = true
          }
        }
      }
      setItems((prev) => prev.filter((c) => !removed.has(c.id)))
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '删除失败' })
    }
  }

  const startReply = (c: CommentRow) => {
    setReplyTo(c.id)
    setRAuthor(author || readCookie(NICK_COOKIE))
    setRBody('')
    setRPrivate(false)
  }

  const renderMeta = (c: CommentRow) => (
    <div className="zx-c-head">
      {c.author_link ? (
        <a className="zx-c-author" href={c.author_link} target="_blank" rel="noreferrer nofollow">
          {c.author}
        </a>
      ) : (
        <span className="zx-c-author">{c.author}</span>
      )}
      {!!c.is_admin && <span className="zx-admin-tag">站长</span>}
      {c.visibility === 'private' && <span className="zx-private-tag">仅站长可见</span>}
      <span className="zx-c-time">{fmtDateTime(c.created_at)}</span>
      <span className="zx-c-actions">
        {replyTo !== c.id && (
          <button type="button" className="zx-linkbtn" onClick={() => startReply(c)}>
            回复
          </button>
        )}
        {isAdmin && (
          <button type="button" className="zx-linkbtn" onClick={() => void onDelete(c.id)}>
            删除
          </button>
        )}
      </span>
    </div>
  )

  const renderReplyForm = (parent: CommentRow) => (
    <form className="zx-reply-form" onSubmit={(e) => void onSubmitReply(e, parent)}>
      <div className="zx-row">
        <input
          className="zx-input"
          placeholder="昵称"
          value={rAuthor}
          maxLength={32}
          onChange={(e) => setRAuthor(e.target.value)}
        />
        <input
          className="zx-input"
          placeholder="回复内容"
          value={rBody}
          maxLength={500}
          onChange={(e) => setRBody(e.target.value)}
        />
      </div>
      <div className="zx-reply-actions">
        <label className="zx-check">
          <input type="checkbox" checked={rPrivate} onChange={(e) => setRPrivate(e.target.checked)} />
          仅站长可见
        </label>
        <span className="zx-muted zx-mono" style={{ fontSize: '0.68rem' }}>
          → @{parent.author}
        </span>
        <button className="zx-btn zx-btn-sm zx-btn-primary" type="submit" disabled={rBusy}>
          {rBusy ? '发送中…' : '回复'}
        </button>
        <button className="zx-btn zx-btn-sm zx-btn-ghost" type="button" onClick={() => setReplyTo(null)}>
          取消
        </button>
      </div>
    </form>
  )

  const renderMention = (c: CommentRow) => {
    if (!c.parent_id) return null
    const t = targetOf(c)
    return (
      <div className="zx-reply-to">
        回复 <span className="zx-reply-to-name">@{t ? t.author : '某人'}</span>
      </div>
    )
  }

  return (
    <Section id="guestbook" tag="// GUESTBOOK" num="04" title="留言板">
      <div
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: '2rem' }}
        className="zx-guestbook-grid"
      >
        <form className="zx-form" onSubmit={onSubmitTop} noValidate>
          <div className="zx-row">
            <div className="zx-field">
              <label className="zx-label" htmlFor="gb-author">
                nickname *
              </label>
              <input
                id="gb-author"
                className="zx-input"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                maxLength={32}
                placeholder="你的昵称"
              />
            </div>
            <div className="zx-field">
              <label className="zx-label" htmlFor="gb-link">
                link (可选)
              </label>
              <input
                id="gb-link"
                className="zx-input"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://"
              />
            </div>
          </div>
          <div className="zx-field">
            <label className="zx-label" htmlFor="gb-body">
              message *
            </label>
            <textarea
              id="gb-body"
              className="zx-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={500}
              placeholder="说点什么…(纯文本,无 HTML)"
            />
          </div>
          <label className="zx-check">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            仅站长可见 🔒
          </label>
          <div>
            <button className="zx-btn zx-btn-primary" type="submit" disabled={busy}>
              {busy ? '发送中…' : '发送留言'}
            </button>
          </div>
          {msg && <div className={`zx-msg ${msg.kind}`}>{msg.text}</div>}
          {isAdmin && (
            <div className="zx-muted zx-mono" style={{ fontSize: '0.72rem' }}>
              ✓ 已登录站长:可看私密留言、回复/删除
            </div>
          )}
        </form>

        <div>
          <div className="zx-mono zx-muted" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
            // {roots.length} 条留言{isAdmin ? '(含私密)' : ''}
          </div>
          <div className="zx-comments">
            {roots.length === 0 && <div className="zx-c-empty">还没有留言,来抢沙发 →</div>}
            {roots.map((c) => (
              <div className="zx-comment" key={c.id}>
                {renderMeta(c)}
                <div className="zx-c-body">{c.body}</div>
                {replyTo === c.id && renderReplyForm(c)}

                {repliesFor(c.id).length > 0 && (
                  <div className="zx-replies">
                    {repliesFor(c.id).map((r) => (
                      <div className="zx-comment zx-reply" key={r.id}>
                        {renderMeta(r)}
                        {renderMention(r)}
                        <div className="zx-c-body">{r.body}</div>
                        {replyTo === r.id && renderReplyForm(r)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}
