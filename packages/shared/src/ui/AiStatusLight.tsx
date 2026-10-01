'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AI_COLOR, AI_LABEL, useAiStatus, type AiState } from './ai-status.js'

/** 鼠标从灯移向浮窗要跨过浮窗上方那道缝,给一点宽限,否则会「一离开就消失」 */
const HOVER_CLOSE_DELAY = 180

/**
 * 导航栏常驻的 AI 状态灯(横版/竖版三灯)。
 *
 * 形态与动画移植自 AI-Status-Light 的网页虚拟灯(`web/control.html` 的 VIR 表):
 * 三盏红/黄/绿,未亮的 opacity .07 + 凹槽阴影,亮哪盏看哪盏。尺寸按视口宽度
 * 分档(横版 B 档 / 竖版 C 档),详见 styles.css 的「AI 状态灯」段。
 *
 * **悬浮展开逐源明细**:`onMouseEnter` 即浮出各 AI 服务当前状态,访客与站长都能看
 * —— 访客看到的只有自己那几个源(`ownerOnly` 的全局源对他们不可见),这本来就是
 * 「你自己的灯」。旁边的状态文字仍只给站长,免得导航栏上多一行常驻文案。
 * 触屏没有悬浮,靠点击;键盘用聚焦。
 *
 * 摆放由 CSS 决定,同一个节点三种形态:
 *  - sidebar 布局 + 桌面:左侧列底部,**竖排**(C 档,更大)
 *  - 顶栏布局:导航栏下沿正中,**横排**(B 档,绝对定位不占高度)
 *  - 手机(≤820px):换行后的导航栏正下方,横排
 */
export function AiStatusLight({ admin }: { admin?: boolean }) {
  const { state, sources } = useAiStatus(!!admin)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setMounted(true), [])

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])

  const show = useCallback(() => {
    clearHover()
    setOpen(true)
  }, [clearHover])

  /** 延迟关闭:指针还要穿过灯与浮窗之间那道 10px 缝 */
  const hideSoon = useCallback(() => {
    clearHover()
    hoverTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY)
  }, [clearHover])

  useEffect(() => clearHover, [clearHover])

  const place = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(248, vw - 24)
    const gap = 10

    // 左栏(sidebar)场景贴着屏幕左边,向右展开;顶栏场景以灯为中心居中
    const left = r.left < 160
      ? r.right + gap
      : r.left + r.width / 2 - width / 2
    const height = 46 + sources.length * 30
    let top = r.bottom + gap
    if (top + height > vh - 12) top = Math.max(12, r.top - gap - height)
    setPos({
      top,
      left: Math.min(Math.max(12, left), vw - width - 12),
    })
  }, [sources.length])

  useLayoutEffect(() => {
    if (!open) return
    place()
    const onMove = () => place()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rows = sources.filter((s) => admin || !s.ownerOnly)
  const popover =
    open && mounted && pos
      ? createPortal(
          <div
            ref={popRef}
            className="zx-pop zx-pop-fixed zx-aistatus-pop"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              right: 'auto',
              width: Math.min(248, window.innerWidth - 24),
            }}
            onMouseEnter={show}
            onMouseLeave={hideSoon}
          >
            <div className="zx-aistatus-pop-head">
              站内 AI · {AI_LABEL[state]}
            </div>
            {rows.map((s) => (
              <div key={s.id} className={`zx-aistatus-row${s.available ? '' : ' is-off'}`}>
                <i className="zx-aistatus-mini" style={{ background: AI_COLOR[s.state as AiState] }} />
                <span className="zx-aistatus-row-label">{s.label}</span>
                <span className="zx-aistatus-row-state">{s.available ? AI_LABEL[s.state] : '未打开'}</span>
              </div>
            ))}
            {rows.some((s) => s.detail) && (
              <div className="zx-aistatus-pop-foot">{rows.find((s) => s.detail)?.detail}</div>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <div
      ref={wrapRef}
      className={`zx-aistatus-wrap${admin ? ' is-admin' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`AI 状态:${AI_LABEL[state]}`}
      aria-expanded={open}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocus={show}
      onBlur={hideSoon}
      onClick={() => {
        // 有悬浮能力的设备上,开关交给 hover,点击只负责「打开」—— 否则鼠标还停在
        // 灯上却被点击关掉,观感别扭。触屏没有 hover,点击才当开关用。
        const canHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches
        setOpen(canHover ? true : (o) => !o)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setOpen((o) => !o)
        }
      }}
    >
      <div className={`zx-aistatus is-${state}`}>
        <i className="zx-aistatus-lamp is-r" />
        <i className="zx-aistatus-lamp is-y" />
        <i className="zx-aistatus-lamp is-g" />
      </div>
      {admin && <span className="zx-aistatus-label">{AI_LABEL[state]}</span>}
      {popover}
    </div>
  )
}
