'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AI_COLOR, AI_LABEL, useAiStatus, type AiState } from './ai-status.js'

/**
 * 导航栏常驻的 AI 状态灯(横版/竖版三灯)。
 *
 * 形态与动画移植自 AI-Status-Light 的网页虚拟灯(`web/control.html` 的 VIR 表):
 * 三盏红/黄/绿,未亮的 opacity .07 + 凹槽阴影,亮哪盏看哪盏。
 *
 * **访客只看到灯本身**:无文字、无 title、无悬停、无展开 —— 只知道「AI 在忙」。
 * 站长额外有状态文字与逐源明细。
 *
 * 摆放由 CSS 决定,同一个节点三种形态:
 *  - sidebar 布局 + 桌面:左侧列底部,**竖排**(`margin-top:auto`)
 *  - 顶栏布局:导航栏下沿正中,**横排**(绝对定位,不占高度)
 *  - 手机(≤820px):换行后的导航栏正下方,横排且更小
 */
export function AiStatusLight({ admin }: { admin?: boolean }) {
  const { state, sources } = useAiStatus(!!admin)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

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
    admin && open && mounted && pos
      ? createPortal(
          <div
            ref={popRef}
            className="zx-pop zx-pop-fixed zx-aistatus-pop"
            style={{ position: 'fixed', top: pos.top, left: pos.left, right: 'auto', width: Math.min(248, window.innerWidth - 24) }}
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
              <div className="zx-aistatus-pop-foot">
                {rows.find((s) => s.detail)?.detail}
              </div>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <div
      ref={wrapRef}
      className={`zx-aistatus-wrap${admin ? ' is-admin' : ''}`}
      {...(admin
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `AI 状态:${AI_LABEL[state]}`,
            'aria-expanded': open,
            onClick: () => setOpen((o) => !o),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOpen((o) => !o)
              }
            },
          }
        : { 'aria-hidden': true })}
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
