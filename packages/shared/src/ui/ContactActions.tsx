'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CONTACTS, type Contacts } from '../content.js'

interface ContactActionsProps {
  contacts?: Contacts
  variant?: 'full' | 'compact'
}

const POP_W = 330
const POP_GAP = 8

export function ContactActions({ contacts, variant = 'full' }: ContactActionsProps) {
  const c = contacts ?? CONTACTS
  const [toast, setToast] = useState('')
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  function flash(msg: string) {
    setToast(msg)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(''), 2400)
  }

  async function copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text)
      flash(msg)
    } catch {
      flash(`复制失败,请手动:${text}`)
    }
  }

  // 点击微信:复制微信号 + 在点击处右上角弹出二维码浮窗
  function onWechat(e: React.MouseEvent) {
    if (c.wechat) void copy(c.wechat, '微信号已复制,请在微信中搜索添加')
    if (!c.wechatQr) return

    const vw = window.innerWidth
    const vh = window.innerHeight
    const x = e.clientX
    const y = e.clientY
    const estH = POP_W * (1131 / 888) + 16 // 按图片比例估算高度

    let left = x + POP_GAP
    let top = y - estH - POP_GAP // 浮窗出现在点击点"右上"→ 底边贴近点击点上方
    if (left + POP_W > vw - 8) left = Math.max(8, x - POP_GAP - POP_W)
    if (top < 8) top = Math.min(vh - estH - 8, y + POP_GAP)
    setPop({ left, top })
  }

  // 点击其它位置 / Esc / 滚动 → 关闭浮窗
  useEffect(() => {
    if (!pop) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      setPop(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPop(null)
    }
    const close = () => setPop(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pop])

  async function onPhone() {
    if (!c.hasPhone && !(c.phoneReversed && c.phoneReversed.length)) return
    let phone = ''
    try {
      const res = await fetch('/api/contact/phone', { credentials: 'same-origin' })
      if (!res.ok) throw new Error()
      phone = ((await res.json()) as { phone?: string }).phone || ''
    } catch {
      flash('获取电话失败,请改用邮件/微信')
      return
    }
    if (!phone) return flash('暂未提供电话')
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    if (mobile) window.location.href = `tel:${phone}`
    else void copy(phone, '电话已复制到剪贴板')
  }

  const hasPhone = !!c.hasPhone || !!c.phoneReversed
  const toastEl = toast ? <div className="zx-toast">{toast}</div> : null

  const qrPop =
    pop && mounted && c.wechatQr
      ? createPortal(
          <div
            ref={popRef}
            className="zx-wechat-pop"
            style={{ position: 'fixed', left: pop.left, top: pop.top, width: POP_W }}
          >
            <img src={c.wechatQr} alt="微信二维码" />
          </div>,
          document.body,
        )
      : null

  if (variant === 'compact') {
    return (
      <span className="zx-contact-compact">
        <a href={`mailto:${c.email}`}>邮件</a>
        {c.wechat && (
          <button type="button" className="zx-linkbtn" onClick={onWechat}>
            微信
          </button>
        )}
        {hasPhone && (
          <button type="button" className="zx-linkbtn" onClick={() => void onPhone()}>
            电话
          </button>
        )}
        {toastEl}
        {qrPop}
      </span>
    )
  }

  return (
    <>
      <a className="zx-btn" href={`mailto:${c.email}`}>
        <span className="zx-ico zx-ico-lg" aria-hidden="true">
          ✉
        </span>{' '}
        邮件
      </a>
      {c.wechat && (
        <button type="button" className="zx-btn" onClick={onWechat} title={`微信号:${c.wechat}`}>
          <span className="zx-ico zx-ico-sm" aria-hidden="true">
            💬
          </span>{' '}
          微信 · {c.wechat}
        </button>
      )}
      {hasPhone && (
        <button type="button" className="zx-btn" onClick={() => void onPhone()} title="点击拨打 / 复制">
          <span className="zx-ico zx-ico-lg" aria-hidden="true">
            ☎
          </span>{' '}
          电话
        </button>
      )}
      {toastEl}
      {qrPop}
    </>
  )
}
