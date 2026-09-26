'use client'

// 右下角漂浮的问答机器人。配置走 /api/chat/config(公开,不含密钥);
// 流式读取 /api/chat 返回的 text/plain。浮标可拖动、窗口可八向缩放、回复按 Markdown 渲染。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MessageIcon } from './icons.js'

interface ChatConfig {
  enabled: boolean
  name: string
  greetings: string[]
  /** @deprecated 兼容旧字段 */
  greeting?: string
  autoOpen: boolean
  suggestions: string[]
  ready: boolean
}

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

interface Pos {
  x: number
  y: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const SESSION_KEY = 'zx.chat.session'
const FAB_KEY = 'zx.chat.fab.v2'
const RECT_KEY = 'zx.chat.rect'
const FAB_SIZE = 52
const MARGIN = 16
const MIN_W = 320
const MIN_H = 360

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

const clampNum = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

function defaultPos(): Pos {
  const x = window.innerWidth - FAB_SIZE - MARGIN
  let y = window.innerHeight - FAB_SIZE - MARGIN
  const help = document.querySelector('.zx-help')
  if (help) {
    const r = help.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) y = r.top - FAB_SIZE - 12
  }
  return clampPos({ x, y })
}

function clampPos(p: Pos): Pos {
  const maxX = Math.max(MARGIN, window.innerWidth - FAB_SIZE - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - FAB_SIZE - MARGIN)
  return { x: clampNum(p.x, MARGIN, maxX), y: clampNum(p.y, MARGIN, maxY) }
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(FAB_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Pos
      if (p && typeof p.x === 'number' && typeof p.y === 'number') return clampPos(p)
    }
  } catch {
    /* ignore */
  }
  return clampPos(defaultPos())
}

function clampRect(r: Rect): Rect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(MIN_W, Math.min(760, vw - 24))
  const maxH = Math.max(MIN_H, Math.min(860, vh - 24))
  const w = clampNum(r.w, MIN_W, maxW)
  const h = clampNum(r.h, MIN_H, maxH)
  const x = clampNum(r.x, 12, Math.max(12, vw - w - 12))
  const y = clampNum(r.y, 12, Math.max(12, vh - h - 12))
  return { x, y, w, h }
}

function loadRect(): Rect | null {
  try {
    const raw = localStorage.getItem(RECT_KEY)
    if (raw) {
      const r = JSON.parse(raw) as Rect
      if (r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number')) return clampRect(r)
    }
  } catch {
    /* ignore */
  }
  return null
}

const mdComponents: Components = {
  a({ node, ...props }) {
    void node
    return <a {...props} target="_blank" rel="noreferrer noopener" />
  },
}

export function ChatWidget() {
  const [cfg, setCfg] = useState<ChatConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [greeting, setGreeting] = useState('')
  const [pos, setPos] = useState<Pos | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)

  const sessionRef = useRef<string>('')
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; rx: number; ry: number; moved: boolean } | null>(null)
  const resizeRef = useRef<{ dir: string; sx: number; sy: number; r0: Rect } | null>(null)

  useEffect(() => {
    let on = true
    fetch('/api/chat/config', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((d: ChatConfig) => {
        if (on) setCfg(d)
      })
      .catch(() => {
        if (on) setCfg({ enabled: false, name: '', greetings: [], autoOpen: false, suggestions: [], ready: false })
      })
    return () => {
      on = false
    }
  }, [])

  // 浮标位置/窗口几何(客户端):读取记忆并按视口纠正;resize 时纠偏
  useEffect(() => {
    setPos(loadPos())
    setRect(loadRect())
    const onResize = () => {
      setPos((p) => clampPos(p ?? loadPos()))
      setRect((r) => (r ? clampRect(r) : r))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 配置就绪后随机取一条问候语(本页固定)
  useEffect(() => {
    if (!cfg) return
    const list = (cfg.greetings?.length ? cfg.greetings : cfg.greeting ? [cfg.greeting] : []).filter(Boolean)
    if (list.length) setGreeting(list[Math.floor(Math.random() * list.length)])
  }, [cfg])

  // 进入页面自动弹出
  useEffect(() => {
    if (cfg?.enabled && cfg.autoOpen) setOpen(true)
  }, [cfg])

  function scrollToBottom() {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  // 注意:所有 hook 必须在下面这个提前返回之前,保证每帧 hook 数量一致
  useEffect(() => {
    if (!cfg || !cfg.enabled) return
    if (open && messages.length === 0 && greeting) {
      setMessages([{ role: 'assistant', content: greeting }])
    }
    if (open) scrollToBottom()
  }, [open, messages.length, greeting, cfg])

  // 首次打开、且无记忆几何时:按浮标就近推导初始矩形(右下锚定)
  useEffect(() => {
    if (!open || !pos) return
    setRect((r) => {
      if (r) return clampRect(r)
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = Math.min(380, vw - 32)
      const h = Math.min(560, vh * 0.75)
      const leftHalf = pos.x + FAB_SIZE / 2 < vw / 2
      const x = leftHalf ? pos.x + FAB_SIZE + 12 : pos.x - w - 12
      const y = pos.y + FAB_SIZE - h
      return clampRect({ x, y, w, h })
    })
  }, [open, pos])

  if (!cfg || !cfg.enabled) return null

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

  /* ---------- 浮标拖动 ---------- */
  const onDragStart = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pos ?? defaultPos()
    const r = rect ?? null
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, rx: r?.x ?? 0, ry: r?.y ?? 0, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onDragMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    const np = clampPos({ x: d.ox + dx, y: d.oy + dy })
    setPos(np)
    // 窗口开着时跟着浮标一起走
    if (open) setRect((r) => (r ? clampRect({ ...r, x: d.rx + (np.x - d.ox), y: d.ry + (np.y - d.oy) }) : r))
  }

  const onDragEnd = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.moved) {
      setPos((p) => {
        if (p) {
          try {
            localStorage.setItem(FAB_KEY, JSON.stringify(p))
          } catch {
            /* ignore */
          }
        }
        return p
      })
    } else {
      setOpen((o) => !o)
    }
  }

  /* ---------- 八向缩放 ---------- */
  const measuredRect = (): Rect => {
    const el = panelRef.current
    if (el) {
      const b = el.getBoundingClientRect()
      return { x: b.x, y: b.y, w: b.width, h: b.height }
    }
    return rect ?? { x: 12, y: 12, w: 380, h: 560 }
  }

  const onResizeStart = (dir: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    resizeRef.current = { dir, sx: e.clientX, sy: e.clientY, r0: measuredRect() }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = resizeRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    const r0 = d.r0
    let { x, y, w, h } = r0
    if (d.dir.includes('e')) w = r0.w + dx
    if (d.dir.includes('s')) h = r0.h + dy
    if (d.dir.includes('w')) {
      x = r0.x + dx
      w = r0.w - dx
    }
    if (d.dir.includes('n')) {
      y = r0.y + dy
      h = r0.h - dy
    }
    if (w < MIN_W) {
      if (d.dir.includes('w')) x = r0.x + (r0.w - MIN_W)
      w = MIN_W
    }
    if (h < MIN_H) {
      if (d.dir.includes('n')) y = r0.y + (r0.h - MIN_H)
      h = MIN_H
    }
    setRect(clampRect({ x, y, w, h }))
  }

  const onResizeEnd = () => {
    resizeRef.current = null
    setRect((r) => {
      if (r) {
        try {
          localStorage.setItem(RECT_KEY, JSON.stringify(r))
        } catch {
          /* ignore */
        }
      }
      return r
    })
  }

  const panelStyle = rect
    ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h, right: 'auto' as const, bottom: 'auto' as const }
    : undefined

  return (
    <>
      {open && (
        <div className="zxchat zxchat--d1" ref={panelRef} style={panelStyle}>
          {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => (
            <div
              key={dir}
              className={`zxchat-edge zxchat-edge-${dir}`}
              onPointerDown={onResizeStart(dir)}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={() => (resizeRef.current = null)}
            />
          ))}
          <div className="zxchat-head">
            <div className="zxchat-avatar">刘</div>
            <div className="zxchat-hmeta">
              <div className="zxchat-hname">{cfg.name}</div>
              <div className="zxchat-hsub">
                <span className={`zxchat-dot${busy ? ' is-busy' : ''}`} />
                {!cfg.ready ? '未就绪' : busy ? '正在输入…' : 'AI 分身'}
              </div>
            </div>
            <button className="zxchat-close" onClick={() => setOpen(false)} aria-label="关闭">
              ×
            </button>
          </div>
          <div className="zxchat-list" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`zxchat-row ${m.role === 'user' ? 'zxchat-row-user' : ''}`}>
                <div className="zxchat-bavatar">{m.role === 'user' ? '你' : '刘'}</div>
                <div className={`zxchat-msg ${m.role === 'user' ? 'zxchat-msg-user' : ''}`}>
                  {m.role === 'user' ? (
                    m.content
                  ) : m.content ? (
                    <div className="zxchat-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  ) : busy && i === messages.length - 1 ? (
                    <span className="zxchat-typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    ''
                  )}
                </div>
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
            <button className="zxchat-send" type="submit" disabled={busy || !input.trim()} aria-label="发送">
              {busy ? '…' : '↑'}
            </button>
          </form>
        </div>
      )}
      <button
        className={`zxchat-fab zxchat-fab--f5${open ? ' is-open' : ''}`}
        style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={() => (dragRef.current = null)}
        aria-label={open ? '收起聊天' : '聊天机器人'}
        title={open ? '收起' : '点开聊天 · 可拖动'}
      >
        <MessageIcon size={1.15} />
      </button>
    </>
  )
}
