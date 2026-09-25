'use client'

// 右下角漂浮的问答机器人。配置走 /api/chat/config(公开,不含密钥);
// 流式读取 /api/chat 返回的 text/plain。
import { useEffect, useRef, useState } from 'react'
import { MessageIcon } from './icons.js'

interface ChatConfig {
  enabled: boolean
  name: string
  greeting: string
  suggestions: string[]
  ready: boolean
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const SESSION_KEY = 'zx.chat.session'

function loadSession(): string {
  try {
    const v = localStorage.getItem(SESSION_KEY)
    if (v) return v
  } catch {
    /* ignore */
  }
  const id = crypto.randomUUID()
  try {
    localStorage.setItem(SESSION_KEY, id)
  } catch {
    /* ignore */
  }
  return id
}

export function ChatWidget() {
  const [cfg, setCfg] = useState<ChatConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sessionRef = useRef<string>('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let on = true
    fetch('/api/chat/config', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((d: ChatConfig) => {
        if (on) setCfg(d)
      })
      .catch(() => {
        if (on) setCfg({ enabled: false, name: '', greeting: '', suggestions: [], ready: false })
      })
    return () => {
      on = false
    }
  }, [])

  if (!cfg || !cfg.enabled) return null

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  useEffect(() => {
    if (open && messages.length === 0 && cfg.greeting) {
      setMessages([{ role: 'assistant', content: cfg.greeting }])
    }
    if (open) scrollToBottom()
  }, [open, messages.length, cfg.greeting])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setError('')
    const next: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: q, history, session_id: sessionRef.current }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(d.error || `请求失败(${res.status})`)
      }
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('text')) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(d.error || '响应格式错误')
      }
      // 流式读取
      const reader = res.body?.getReader()
      if (!reader) throw new Error('无响应流')
      sessionRef.current = loadSession()
      const decoder = new TextDecoder()
      let acc = ''
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: acc }
          return copy
        })
        scrollToBottom()
      }
      setMessages((prev) => {
        const copy = [...prev]
        if (copy.length) copy[copy.length - 1] = { role: 'assistant', content: acc }
        return copy
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '出错了')
      scrollToBottom()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {open && (
        <div className="zxchat">
          <div className="zxchat-head">
            <div>
              <strong>{cfg.name}</strong>
              <span className="zxchat-head-sub">子祥的 AI 分身 · 试试问他</span>
            </div>
            <button className="zxchat-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
          </div>
          <div className="zxchat-list" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`zxchat-msg ${m.role === 'user' ? 'zxchat-msg-user' : ''}`}>
                {m.content || (busy && i === messages.length - 1 ? '…' : '')}
              </div>
            ))}
            {error && <div className="zxchat-err">{error}</div>}
            {messages.length === 1 && !busy && (
              <div className="zxchat-hint">
                {cfg.suggestions.slice(0, 4).map((s) => (
                  <button key={s} className="zxchat-chip" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            className="zxchat-form"
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
          >
            <input
              className="zxchat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="问点关于子祥的事…"
              maxLength={2000}
            />
            <button className="zxchat-send" type="submit" disabled={busy || !input.trim()}>
              {busy ? '…' : '发送'}
            </button>
          </form>
        </div>
      )}
      {!open && (
        <button className="zxchat-fab" onClick={() => setOpen(true)} aria-label="聊天机器人">
          <MessageIcon size={1.15} />
        </button>
      )}
    </>
  )
}