'use client'

/**
 * 应用「页内浮层」面板(openIn: 'panel')。
 *
 * 点击应用栏里这类应用时,不跳转,而是在站内弹一个**悬浮窗**,里面用 iframe 载入该应用
 * 自己的地址(比如自建的 Opentodo web 版)。桌面是可拖拽 + 可缩放的浮窗,窄屏直接全屏。
 *
 * 为什么用 portal + position:fixed:应用栏那侧有 overflow,浮层必须挂在 body 上才能
 * 盖满视口、不被裁剪。几何计算复用 floating.ts 的让位逻辑(给右侧/底部应用栏留缝)。
 *
 * 状态经 context 暴露:AppDock 只负责 open(),真正的渲染在 Shell 层(全站唯一一个)。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AppItem } from '../schema.js'
import { normalizeUrl } from '../content.js'
import { bottomGutter, isNarrow, rightGutter } from './floating.js'
import { isAiState, reportAiState, setAiSourceAvailable } from './ai-status.js'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface AppPanelApi {
  open: (app: AppItem) => void
  close: () => void
}

const AppPanelContext = createContext<AppPanelApi | null>(null)

/** 在应用栏里调用:打开某个应用的页内浮层。无 Provider 时返回 null(降级为普通链接)。 */
export function useAppPanel(): AppPanelApi | null {
  return useContext(AppPanelContext)
}

const RECT_KEY = 'zx.apppanel.rect'
const DEFAULT_W = 720
const DEFAULT_H = 680
const MIN_W = 320
const MIN_H = 300

function clampRect(r: Rect): Rect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(MIN_W, Math.min(r.w, Math.max(MIN_W, vw - 20 - rightGutter())))
  const h = Math.max(MIN_H, Math.min(r.h, Math.max(MIN_H, vh - 20 - bottomGutter())))
  const x = Math.max(8, Math.min(r.x, Math.max(8, vw - w - 8 - rightGutter())))
  const y = Math.max(8, Math.min(r.y, Math.max(8, vh - h - 8 - bottomGutter())))
  return { x, y, w, h }
}

function defaultRect(): Rect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(DEFAULT_W, Math.max(MIN_W, vw - 32))
  const h = Math.min(DEFAULT_H, Math.max(MIN_H, vh - 32 - bottomGutter()))
  const x = Math.round((vw - w) / 2)
  const y = Math.max(12, Math.round((vh - h) / 2 - 16))
  return clampRect({ x, y, w, h })
}

function loadRect(): Rect {
  try {
    const raw = window.localStorage.getItem(RECT_KEY)
    if (raw) {
      const r = JSON.parse(raw) as Partial<Rect>
      if (r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number')) return clampRect(r as Rect)
    }
  } catch {
    /* 隐私模式 / 坏数据:用默认 */
  }
  return defaultRect()
}

/** 全站唯一的浮层宿主:包住 children,并负责渲染当前打开的应用面板。 */
export function AppPanelProvider({ children }: { children: ReactNode }) {
  /**
   * 打开过的应用**保持挂载**（仅隐藏非当前项），这样点面板外「收起」后再打开，
   * iframe 不会被销毁重建 —— 子应用（如易经）的临时状态得以保留。
   */
  const [apps, setApps] = useState<AppItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const api = useMemo<AppPanelApi>(
    () => ({
      open: (a) => {
        setApps((prev) => {
          const i = prev.findIndex((p) => p.id === a.id)
          if (i === -1) return [...prev, a]
          const next = prev.slice()
          next[i] = a
          return next
        })
        setActiveId(a.id)
      },
      close: () => setActiveId(null),
    }),
    [],
  )
  return (
    <AppPanelContext.Provider value={api}>
      {children}
      {apps.map((a) => (
        <AppPanel key={a.id} app={a} active={a.id === activeId} onClose={api.close} />
      ))}
    </AppPanelContext.Provider>
  )
}

function AppPanel({ app, active, onClose }: { app: AppItem; active: boolean; onClose: () => void }) {
  const href = normalizeUrl(app.url)
  const [rect, setRect] = useState<Rect | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{ sx: number; sy: number; r0: Rect } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRect(loadRect())
    const onWinResize = () => setRect((r) => (r ? clampRect(r) : r))
    window.addEventListener('resize', onWinResize)
    return () => window.removeEventListener('resize', onWinResize)
  }, [])

  // 仅当前面板监听「Esc / 点外部收起」；隐藏面板不挂监听，免得在别处点击时误关当前面板
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // 点面板外收起(点 iframe 内部收不到 —— 跨域,正合适)
    const onDown = (e: PointerEvent) => {
      const el = panelRef.current
      if (el && !el.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [active, onClose])

  /**
   * 跨子域应用上报自己的 AI 状态:iframe 里 `postMessage({type:'zx:ai-status',...})`,
   * 这里校验 origin 与 app.id 后并入状态总线(协议见 docs/AI-STATUS.md)。
   *
   * 校验 origin 是必须的:任何页面都能给我们发 message,不加校验等于让任意站点
   * 点亮站内的灯。来源 id 直接用 app.id,与 ai-status.ts 的 AI_SOURCES 对齐,
   * 这样新增应用只需在注册表登记一行,博客侧零改动。
   *
   * 面板挂载 = 该应用此刻可用;关掉即置 unavailable(灯熄灭、退出合并),
   * 免得留一盏黄灯空转到 TTL 结束。
   */
  useEffect(() => {
    let origin = ''
    try {
      origin = new URL(href).origin
    } catch {
      return
    }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== origin) return
      const d = e.data as { type?: string; app?: string; state?: unknown; detail?: string } | null
      if (!d || typeof d !== 'object') return
      if (d.type !== 'zx:ai-status' || d.app !== app.id) return
      if (!isAiState(d.state)) return
      // detail 来自跨子域来源,截断防超长文本撑爆浮窗
      reportAiState(app.id, d.state, typeof d.detail === 'string' ? d.detail.slice(0, 120) : undefined)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [app.id, href])

  // 可用性跟随「是否当前展开」：收起即熄灭状态灯(应用仍在后台挂载，状态不丢)
  useEffect(() => {
    setAiSourceAvailable(app.id, active)
    return () => setAiSourceAvailable(app.id, false)
  }, [app.id, active])

  // 换应用:重置加载态;迟迟不 onLoad 就提示走「新标签页」兜底
  useEffect(() => {
    setLoaded(false)
    setSlow(false)
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [app.id])

  const save = useCallback((r: Rect) => {
    try {
      window.localStorage.setItem(RECT_KEY, JSON.stringify(r))
    } catch {
      /* ignore */
    }
  }, [])

  const onDragStart = (e: ReactPointerEvent) => {
    if (!rect) return
    if ((e.target as HTMLElement).closest('button, a')) return
    dragRef.current = { dx: e.clientX - rect.x, dy: e.clientY - rect.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: ReactPointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setRect((r) => (r ? clampRect({ ...r, x: e.clientX - d.dx, y: e.clientY - d.dy }) : r))
  }
  const onDragEnd = () => {
    dragRef.current = null
    setRect((r) => {
      if (r) save(r)
      return r
    })
  }

  const onResizeStart = (e: ReactPointerEvent) => {
    if (!rect) return
    e.stopPropagation()
    resizeRef.current = { sx: e.clientX, sy: e.clientY, r0: rect }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: ReactPointerEvent) => {
    const d = resizeRef.current
    if (!d) return
    setRect(
      clampRect({
        ...d.r0,
        w: d.r0.w + (e.clientX - d.sx),
        h: d.r0.h + (e.clientY - d.sy),
      }),
    )
  }
  const onResizeEnd = () => {
    resizeRef.current = null
    setRect((r) => {
      if (r) save(r)
      return r
    })
  }

  if (typeof document === 'undefined' || !href) return null
  const narrow = isNarrow()
  const initial = (app.name.trim()[0] ?? '?').toUpperCase()

  return createPortal(
    <div
      ref={panelRef}
      className="zx-apppanel"
      data-narrow={narrow ? '' : undefined}
      hidden={!active}
      role="dialog"
      aria-label={app.name}
      style={narrow || !rect ? undefined : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        className="zx-apppanel-bar"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <span className="zx-apppanel-ico">
          {app.icon ? <img src={app.icon} alt="" draggable={false} /> : initial}
        </span>
        <span className="zx-apppanel-name">{app.name}</span>
        <span className="zx-apppanel-spacer" />
        <a
          className="zx-apppanel-btn"
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title="在新标签页打开"
        >
          ↗
        </a>
        <button className="zx-apppanel-btn" type="button" onClick={onClose} title="关闭 (Esc)">
          ✕
        </button>
      </div>

      <div className="zx-apppanel-body">
        {!loaded && (
          <div className="zx-apppanel-loading">
            <span className="zx-apppanel-spin" />
            {slow && (
              <span className="zx-apppanel-hint">
                加载较慢或该应用不允许被嵌入 ——{' '}
                <a href={href} target="_blank" rel="noreferrer noopener">
                  在新标签页打开
                </a>
              </span>
            )}
          </div>
        )}
        <iframe
          key={app.id}
          src={href}
          title={app.name}
          onLoad={() => setLoaded(true)}
          /*
           * 必须是 `origin`,不能是 `no-referrer`:跨源 iframe 要靠
           * `document.referrer` 反推宿主 origin 才知道 postMessage 该发给谁
           * (见 docs/AI-STATUS.md)。`no-referrer` 会让它拿到空串,于是
           * `HOST_ORIGIN` 为空、应用直接不上报 —— 表现为「AI 状态灯死活不变」。
           * `origin` 只透出 origin(不含路径与查询串),够用又不泄漏具体页面。
           */
          referrerPolicy="origin"
          allow="clipboard-write; fullscreen"
        />
      </div>

      {!narrow && (
        <span
          className="zx-apppanel-grip"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
        />
      )}
    </div>,
    document.body,
  )
}
