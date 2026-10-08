'use client'

// 右下角漂浮的问答机器人。配置走 /api/chat/config(公开,不含密钥);
// 流式读取 /api/chat 返回的 text/plain。浮标可拖动、窗口可八向缩放、回复按 Markdown 渲染。
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MessageIcon } from './icons.js'
import { setAiSourceAvailable, useReportAiState } from './ai-status.js'
import { bottomGutter, maxX, rightGutter } from './floating.js'

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
const AUTOOPEN_KEY = 'zx.chat.autoOpened'
const FAB_SIZE = 52
const MARGIN = 16
const MIN_W = 320
const MIN_H = 360
const TEASER_DELAY = 1200
const TEASER_DURATION = 7000
/** 首访自动开窗前留给首屏布局稳定的时间 + 等视频卡挂上来的上限 */
const AUTOOPEN_DELAY = 800
const AUTOOPEN_POLL_MS = 250
const AUTOOPEN_WAIT_MAX = 6000
/** 视频卡中央播放区半径(与 HeroVlog 的 PLAY_ZONE / PLAY_ZONE_MIN 保持一致) */
const PLAY_ZONE = 0.26
const PLAY_ZONE_MIN = 72

/**
 * 聊天窗(右下角浮标锚定)会不会压住 Hero 视频卡的中央播放区。
 *
 * 窗口宽 min(380, 100vw-32)、高 min(560, 75vh),在手机上正好盖住视频卡中央 —— 那一下
 * 点击全落在聊天框上,视频点不动(还表现为「聊天在一直打字」)。压住就不自动弹,留给
 * 用户点浮标自己开。圆(播放区)与矩形(窗口)相交即算压住。
 */
function coversActiveVlog(
  win: { x: number; y: number; w: number; h: number },
  cardRect?: DOMRect | null
): boolean | null {
  let c: DOMRect | null = null
  if (cardRect) {
    c = cardRect
  } else {
    const card = document.querySelector('.zx-vlog-card.is-active')
    if (!(card instanceof HTMLElement)) return null
    c = card.getBoundingClientRect()
  }
  // 量不到(尺寸还是 0)不等于「没压住」—— 慢设备上布局还没稳定,此时若按「没压住」开窗,
  // 窗口就会落在稍后才量出尺寸的卡片上,视频再也点不动。返回 null = 还量不准,让调用方继续等。
  if (!c || c.width === 0 || c.height === 0) return null
  // 卡片中心不在视口内(手机上视频区通常在首屏之下,而聊天窗浮在视口上):判「压没压住」要看
  // 用户滚到视频时的情况,那时卡片中心基本就在视口中心。仍按当前坐标量会得出「没压住」→
  // 自动开窗,等用户滚下去视频就被盖住(实测落点=DIV.zxchat-list)。所以中心不在视口内时
  // 按视口中心算,宁可保守不自动弹。
  const rawCx = c.left + c.width / 2
  const rawCy = c.top + c.height / 2
  const centerInView =
    rawCx >= 0 && rawCx <= window.innerWidth && rawCy >= 0 && rawCy <= window.innerHeight
  const cx = centerInView ? rawCx : window.innerWidth / 2
  const cy = centerInView ? rawCy : window.innerHeight / 2
  const radius = Math.max(PLAY_ZONE_MIN, Math.min(c.width, c.height) * PLAY_ZONE)
  const nx = Math.max(win.x, Math.min(cx, win.x + win.w))
  const ny = Math.max(win.y, Math.min(cy, win.y + win.h))
  return Math.hypot(cx - nx, cy - ny) <= radius
}

/** 最近一次量到的卡片矩形(供稳定判定用) */
let lastCardRect: { w: number; h: number; left: number; top: number } | null = null

/**
 * 量当前卡片的矩形,且要求**连续两次量到相同尺寸**才认。
 *
 * 慢设备(实测 4x CPU 降速 + Fast3G)上卡片会先以 350x213 出现、1s 后才跳到 740x451:
 * 只量一次容易落在中间态,判成「窗口没压住」就自动开窗,等卡片跳到最终尺寸时正好被盖住,
 * 视频再也点不动(实测落点变成 DIV.zxchat-list)。尺寸还在变就返回 null,让调用方继续等。
 */
function stableCardRect(): DOMRect | null {
  const card = document.querySelector('.zx-vlog-card.is-active')
  if (!(card instanceof HTMLElement)) {
    lastCardRect = null
    return null
  }
  const c = card.getBoundingClientRect()
  if (c.width === 0 || c.height === 0) {
    lastCardRect = null
    return null
  }
  const p = lastCardRect
  if (p && p.w === c.width && p.h === c.height) return c
  lastCardRect = { w: c.width, h: c.height, left: c.left, top: c.top }
  return null
}

/** 首次打开时的窗口矩形:按浮标就近推导(右下锚定) */
function defaultWindowRect(pos: { x: number; y: number } | null): {
  x: number
  y: number
  w: number
  h: number
} {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(380, vw - 32)
  const h = Math.min(560, vh * 0.75)
  const fab = pos ?? { x: vw - FAB_SIZE - 20, y: vh - FAB_SIZE - 20 }
  const leftHalf = fab.x + FAB_SIZE / 2 < vw / 2
  const x = leftHalf ? fab.x + FAB_SIZE + 12 : fab.x - w - 12
  const y = fab.y + FAB_SIZE - h
  return { x, y, w, h }
}

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
  const x = window.innerWidth - FAB_SIZE - MARGIN - rightGutter()
  // 窄屏时应用栏是底部横条,浮标要整体上移一个栏高,否则会压在横条上
  // (浮标坐标是行内 top/left,样式表里的 bottom 让位不生效,必须在这里扣)
  const y = window.innerHeight - FAB_SIZE - MARGIN - bottomGutter()
  return clampPos({ x, y })
}

function clampPos(p: Pos): Pos {
  const maxY = Math.max(MARGIN, window.innerHeight - FAB_SIZE - MARGIN - bottomGutter())
  return { x: clampNum(p.x, MARGIN, maxX(FAB_SIZE, MARGIN)), y: clampNum(p.y, MARGIN, maxY) }
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
  const maxH = Math.max(MIN_H, Math.min(860, vh - 24 - bottomGutter()))
  const w = clampNum(r.w, MIN_W, maxW)
  const h = clampNum(r.h, MIN_H, maxH)
  const x = clampNum(r.x, 12, Math.max(12, vw - w - 12 - rightGutter()))
  const y = clampNum(r.y, 12, Math.max(12, vh - h - 12 - bottomGutter()))
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
  const [teaser, setTeaser] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)

  const sessionRef = useRef<string>('')
  /* busy 的 ref 镜像:send() 读的是闭包里的 busy(渲染快照),同一次事件里连发两次
     会在 setBusy 提交前两次都读到 false,并发闸形同虚设。ref 是同步可读的。 */
  const busyRef = useRef(false)
  const reportAi = useReportAiState('avatar')
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const teaserShownRef = useRef(false)
  /** 首访自动开窗只判一次(量播放区要等布局稳定,期间 pos 变化会重跑这个 effect) */
  const autoTriedRef = useRef(false)
  /** 「本页有视频区但卡片还没挂上」的轮询:切走/卸载时用来停掉它(否则会一直 setTimeout) */
  const autoWaitRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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

  // 问候语:优先用服务端组装好的 cfg.greeting;为空才回退静态 greetings 随机
  useEffect(() => {
    if (!cfg) return
    const composed = (cfg.greeting ?? '').trim()
    const list = (cfg.greetings ?? []).filter((s) => s.trim())
    const text = composed || (list.length ? list[Math.floor(Math.random() * list.length)] : '')
    setGreeting(text)
  }, [cfg])

  // 进入页面提示:首访自动开窗;之后每次刷新只弹气泡(与窗口互斥)
  useEffect(() => {
    if (!cfg?.enabled || !cfg.autoOpen) return
    let seen = false
    try {
      seen = !!localStorage.getItem(AUTOOPEN_KEY)
    } catch {
      /* ignore */
    }
    if (!seen) {
      if (autoTriedRef.current) return
      autoTriedRef.current = true
      // 视频区是**异步**渲染的:固定延时去量,它八成还没挂上,于是判成「没压住」→ 开窗,
      // 等卡片挂好正好落在窗口底下(手机全屏宽,必中)。所以先等卡片出现再量;等到上限
      // 还没见着卡片就当本页没有视频区,照常开。
      let waited = 0
      const openNow = () => {
        setOpen(true)
        try {
          localStorage.setItem(AUTOOPEN_KEY, '1')
        } catch {
          /* ignore */
        }
      }
      const tick = () => {
        if (document.querySelector('.zx-vlog-card.is-active')) {
          // 连续量到两次相同尺寸才算布局稳定:慢设备上卡片会在 350x213(未换算好)→
          // 740x451(就位)之间跳,只量一次容易量到中间态,判成「没压住」就开窗,
          // 等它跳到最终尺寸正好被窗口盖住。
          const c = stableCardRect()
          if (c) {
            const cov = coversActiveVlog(defaultWindowRect(pos), c)
            if (cov === false) { openNow(); return }
            if (cov === true) return
          }
        }
        // 视频区在(`.zx-vlog` 是服务端就渲染出来的外壳)但卡片还没挂上 → 是「还没到」,
        // 不是「本页没有视频区」。慢设备 + 慢网下卡片可能要 6s+ 才出现(实测 4x 降速 +
        // Fast3G 会超过原来的上限),若此时按「本页没有视频区」开窗,窗口正好落在稍后
        // 出现的卡片上,视频就再也点不动了。所以这种情况继续等,不受上限约束。
        if (document.querySelector('.zx-vlog')) {
          autoWaitRef.current = setTimeout(tick, AUTOOPEN_POLL_MS)
          return
        }
        if (waited < AUTOOPEN_WAIT_MAX) {
          waited += AUTOOPEN_POLL_MS
          autoWaitRef.current = setTimeout(tick, AUTOOPEN_POLL_MS)
          return
        }
        openNow()
      }
      autoWaitRef.current = setTimeout(tick, AUTOOPEN_DELAY)
      return () => clearTimeout(autoWaitRef.current)
    }
    // 已访问过:延迟弹气泡;若用户先开了窗(open)或本页已弹过则不再弹
    if (open || teaserShownRef.current) return
    const t = setTimeout(() => {
      teaserShownRef.current = true
      setTeaser(true)
    }, TEASER_DELAY)
    return () => clearTimeout(t)
  }, [cfg, open, pos])

  // 窗口与气泡互斥:窗口一开,气泡立即消失
  useEffect(() => {
    if (open) setTeaser(false)
  }, [open])

  // 气泡停留数秒后自动消失
  useEffect(() => {
    if (!teaser) return
    const t = setTimeout(() => setTeaser(false), TEASER_DURATION)
    return () => clearTimeout(t)
  }, [teaser])

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

  // AI 分身是否可叫号:配置未开时不算可用源,状态灯不把它算进去
  useEffect(() => {
    setAiSourceAvailable('avatar', !!cfg?.enabled)
  }, [cfg?.enabled])

  // 首次打开、且无记忆几何时:按浮标就近推导初始矩形(右下锚定)
  useEffect(() => {
    if (!open || !pos) return
    setRect((r) => (r ? clampRect(r) : clampRect(defaultWindowRect(pos))))
  }, [open, pos])

  if (!cfg || !cfg.enabled) return null

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busyRef.current) return
    setError('')
    const next: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setBusy(true)
    busyRef.current = true
    reportAi('thinking')
    // 客户端超时:连接建立后卡住时,避免界面永久停在「正在输入…」
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 180_000)
    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        signal: ac.signal,
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
      reportAi('success')
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      setError(aborted ? '响应超时,请重试' : e instanceof Error ? e.message : '出错了')
      reportAi('error')
      scrollToBottom()
    } finally {
      clearTimeout(timeout)
      busyRef.current = false
      setBusy(false)
    }
  }

  /* ---------- 浮标拖动 ---------- */
  const onDragStart = (e: ReactPointerEvent<HTMLButtonElement>) => {
    setTeaser(false)
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

  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const teaserLeft = !!pos && pos.x + FAB_SIZE / 2 > vw / 2
  const teaserStyle: CSSProperties | undefined = pos
    ? teaserLeft
      ? { top: pos.y + FAB_SIZE / 2, right: vw - pos.x + 12 }
      : { top: pos.y + FAB_SIZE / 2, left: pos.x + FAB_SIZE + 12 }
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
      {teaser && !open && pos && (
        <div
          className={`zxchat-teaser${teaserLeft ? '' : ' zxchat-teaser-right'}`}
          style={teaserStyle}
          role="status"
          onClick={() => {
            setTeaser(false)
            setOpen(true)
          }}
        >
          {greeting || '想了解子祥点什么?点我聊聊。'}
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
