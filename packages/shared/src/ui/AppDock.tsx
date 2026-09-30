'use client'

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AppItem } from '../schema.js'
import { isSpaRoute, normalizeUrl } from '../content.js'
import type { LinkComponent } from './types.js'
import { appsOrderKey } from './identity.js'
import { resolveAppTrack } from './app-track.js'
import { trackEvent } from './track.js'
import { applySavedOrder, groupContiguous, useDragReorder } from './useDragReorder.js'

interface AppDockProps {
  /** 展示用应用条目(已排除垃圾箱);空数组 → 不渲染 */
  apps?: AppItem[]
  /** 注入式链接组件(如 Next 的 Link),缺省用原生 <a> */
  link?: LinkComponent
  /** 模拟访客身份:自定义顺序按身份分键(等价于该访客设备上的顺序) */
  mockId?: string
}

type LinkLike = React.ComponentType<{
  href: string
  className?: string
  target?: string
  rel?: string
  scroll?: boolean
  draggable?: boolean
  'data-label'?: string
  'data-app-id'?: string
  children: React.ReactNode
}>

/** 与 CSS 里的窄屏断点保持一致(竖排 ↔ 横排) */
const NARROW = '(max-width: 820px)'
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * 右侧应用栏:固定在视口右边缘的竖排图标(macOS Dock 竖置版),不随页面滚动移走。
 * 由 html[data-apps='1'] 在 CSS 侧给主内容留出等宽右边距,首帧即到位、不抖动。
 * 窄屏(≤820px)在 CSS 里转为底部横排。
 *
 * 访客可以自己按住拖动调顺序(鼠标 + 触屏都行),顺序按访客身份存 localStorage,
 * 不写库、不影响其他访客和 admin 配的默认顺序。只允许在同一分组内拖动。
 */
export function AppDock({ apps, link, mockId }: AppDockProps) {
  const navRef = useRef<HTMLElement | null>(null)
  const [horizontal, setHorizontal] = useState(false)
  /** 访客自定义的 id 顺序;null = 还没读 / 用默认 */
  const [order, setOrder] = useState<string[] | null>(null)
  const [customized, setCustomized] = useState(false)
  /** 悬停/聚焦时的名称气泡。位置在事件里按图标 rect 现算,portal 到 body —— 见下方注释 */
  const [tip, setTip] = useState<{ text: string; top: number; left: number; side: 'left' | 'top' } | null>(null)

  const storageKey = appsOrderKey(mockId)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(NARROW)
    const on = () => setHorizontal(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  /**
   * 首帧前(paint 之前)按本地顺序重排。
   * 没用「首帧内联脚本改 DOM」那套:应用栏是 React 渲染的子节点,
   * 脚本去搬动它们会造成 hydration 顺序不一致,React 直接报 mismatch。
   * useLayoutEffect 在 DOM 变更后、浏览器 paint 之前同步执行,顺序错乱不会被人看见。
   */
  useIsoLayoutEffect(() => {
    if (typeof window === 'undefined') return
    let saved: string[] | null = null
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const v = JSON.parse(raw)
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) saved = v
      }
    } catch {
      saved = null
    }
    setOrder(saved)
  }, [storageKey])

  // EMPTY 是模块级常量,引用稳定 —— apps 为空时 ids 不会每渲染都换个新数组
  const base = apps ?? EMPTY
  // 先按访客存下的顺序对账 admin 的增删,再按分组归拢:访客拖拽时的组约束只拦得住
  // **新的**跨组拖动,救不了分组之前就写进 localStorage 的交错顺序(表现是两个同组
  // 应用之间凭空多一条分隔线,而 ↺ 能治好 —— 正是它).归拢是纯函数,不必回写存档。
  const list = groupContiguous(applySavedOrder(base, order))
  const ids = list.map((a) => a.id)
  const idsKey = ids.join(' ')
  /**
   * admin 配的**默认**顺序。要跟它比,不能跟上面那个已被重排过的 ids 比 ——
   * 拿重排结果跟自己比永远相等,「恢复默认」按钮就永远不出现。
   */
  const defaultKey = base.map((a) => a.id).join(' ')
  const byId = new Map(list.map((a) => [a.id, a]))

  const { dragId, drop, registerItem, handleProps } = useDragReorder({
    ids,
    axis: horizontal ? 'x' : 'y',
    groupOf: (id) => byId.get(id)?.group ?? '',
    onCommit: (next) => {
      setOrder(next)
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* 隐私模式 / 配额满:这次不落盘,本次会话内仍然有效 */
      }
    },
    getScrollBox: () => navRef.current,
    disabled: list.length < 2,
  })

  /**
   * 名称气泡:不能画在 item 的 ::after 里 —— 应用栏是滚动容器(overflow-y:auto),
   * CSS 会把 overflow-x 也算成 auto,气泡整个在 64px 栏外、被裁掉,永远看不到。
   * 所以 portal 到 body 用 position:fixed,位置按图标 rect 现算。
   */
  const showTip = useCallback(
    (text: string, el: HTMLElement | null) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      setTip(
        horizontal
          ? { text, top: r.top - 8, left: r.left + r.width / 2, side: 'top' }
          : { text, top: r.top + r.height / 2, left: r.left - 10, side: 'left' },
      )
    },
    [horizontal],
  )
  const hideTip = useCallback(() => setTip(null), [])

  // 拖动中收起:气泡会挡住落点,也免得跟着乱飘
  useEffect(() => {
    if (dragId) setTip(null)
  }, [dragId])

  // 应用栏自身滚动时图标会移位,旧坐标就错了 —— 收起,重新悬停即可
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const onScroll = () => setTip(null)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // 只在真的和 admin 默认顺序不一样时,才显示「重置」——平时不占地方
  useEffect(() => {
    // 比的是**渲染出来的** idsKey,不是 localStorage 里的原始 order:归拢之后画面
    // 可能已经等于 admin 默认顺序了,这时再挂一个 ↺ 就是让用户点没用的东西。
    setCustomized(order !== null && order.length > 0 && idsKey !== defaultKey)
    // 依赖字符串形式:数组每渲染都新建,直接进依赖会白跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, idsKey, defaultKey])

  const reset = useCallback(() => {
    setOrder(null)
    setCustomized(false)
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
  }, [storageKey])

  if (!apps || apps.length === 0) return null

  const Comp = (link ?? 'a') as unknown as LinkLike
  const linkExtra = link ? { scroll: false } : {}

  // 分组变化处插一条分隔线(第一项之前不插)
  let seen = false
  let lastGroup = ''

  return (
    <nav
      className="zx-appdock"
      aria-label="应用栏"
      ref={navRef}
      data-dragging-active={dragId ? '' : undefined}
    >
      {list.map((app) => {
        const href = normalizeUrl(app.url)
        if (!href) return null
        const group = app.group ?? ''
        const showSep = seen && group !== lastGroup
        seen = true
        lastGroup = group

        // 只有站内「路由」才交给注入的 Link 走客户端导航(不丢 SPA 状态、保留右键新开)。
        // /resume.pdf 这类由 Caddy 直接吐字节的静态资源走原生 <a> —— 它们在应用里
        // 没有对应路由,走客户端路由只会静默吃掉「打开方式」这个设置。
        // isSpaRoute 已把外链排除在外,所以这里不必再单独判 isExternalUrl。
        const spa = isSpaRoute(href)
        // newtab(缺省):非站内路由开新标签(外链 / 静态文件)
        // self:一律当前页打开
        const newTab = (app.openIn ?? 'newtab') === 'newtab' && !spa
        const common = {
          className: 'zx-appdock-item',
          'data-label': app.name,
          'data-app-id': app.id,
          ref: registerItem(app.id),
          ...handleProps(app.id),
          'data-dragging': dragId === app.id ? '' : undefined,
          'data-drop': drop?.targetId === app.id ? (drop.before ? 'before' : 'after') : undefined,
          // 名称气泡(鼠标悬停 + 键盘聚焦都算)
          onMouseEnter: (e: ReactMouseEvent) => showTip(app.name, e.currentTarget as HTMLElement),
          onMouseLeave: hideTip,
          onFocus: (e: ReactFocusEvent) => showTip(app.name, e.currentTarget as HTMLElement),
          onBlur: hideTip,
          /**
           * 点击埋点:绑定到项目/联系方式/简历的与对应按钮合并计数,没绑定的记 app_click。
           * 拖动后浏览器补发的那次 click 会被 handleProps 的 onClickCapture 吃掉,故只有真点击才计。
           */
          onClick: () => {
            const { type, target } = resolveAppTrack(app)
            trackEvent(type, target)
          },
          /**
           * <a href> 默认是可拖的:一动就触发浏览器原生 drag,随即给指针序列发
           * pointercancel,自建的拖拽当场断掉(鼠标也一样,不只是触屏)。必须关掉。
           */
          draggable: false,
        }

        const item = newTab ? (
          <a {...common} href={href} target="_blank" rel="noreferrer noopener">
            <DockIcon app={app} />
          </a>
        ) : spa ? (
          <Comp {...common} href={href} {...linkExtra}>
            <DockIcon app={app} />
          </Comp>
        ) : (
          <a {...common} href={href}>
            <DockIcon app={app} />
          </a>
        )

        return (
          <Fragment key={app.id}>
            {showSep && <span className="zx-appdock-sep" aria-hidden="true" />}
            {item}
          </Fragment>
        )
      })}

      {customized && (
        <button
          type="button"
          className="zx-appdock-reset"
          title="恢复站长设定的默认顺序"
          onClick={reset}
        >
          ↺
        </button>
      )}

      {tip &&
        createPortal(
          <div
            className="zx-appdock-tip"
            role="tooltip"
            data-side={tip.side}
            style={{ top: tip.top, left: tip.left }}
          >
            {tip.text}
          </div>,
          document.body,
        )}
    </nav>
  )
}

const EMPTY: AppItem[] = []

/**
 * 图标本体:有 icon 且加载成功时显示图片,否则回退到名称首字
 * (没传 icon、或图片 404/解码失败时都走首字,不会留一个破图)。
 */
function DockIcon({ app }: { app: AppItem }) {
  const [state, setState] = useState<'loading' | 'ok' | 'bad'>('loading')
  const letter = Array.from(app.name.trim())[0] ?? '?'

  /**
   * 这个 <img> 是 SSR 出来的,浏览器在解析 HTML 时就开始下载了 ——
   * 等 hydration 完 React 才挂上 onLoad,图片早就 load 完的话事件已经错过,
   * 状态会永远停在 'loading'(首字和图标叠在一起)。
   * 所以用回调 ref 补一刀:挂上时若已 complete,直接按 naturalWidth 定状态。
   */
  const settle = useCallback((el: HTMLImageElement | null) => {
    if (!el || !el.complete) return
    setState(el.naturalWidth > 0 ? 'ok' : 'bad')
  }, [])

  if (!app.icon) return <span className="zx-appdock-letter">{letter}</span>
  return (
    <span className="zx-appdock-img">
      {state !== 'ok' && <span className="zx-appdock-letter">{letter}</span>}
      {state !== 'bad' && (
        <img
          ref={settle}
          src={app.icon}
          alt=""
          loading="lazy"
          decoding="async"
          /**
           * 图片天生可拖:在图标上按下会被浏览器当成"拖这张图"，
           * 随即给指针序列发 pointercancel,自建的拖拽当场断掉。
           * 外层 <a> 的 draggable={false} 管不到它,必须单独关掉。
           */
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('bad')}
        />
      )}
    </span>
  )
}
