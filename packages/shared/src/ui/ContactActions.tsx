'use client'

import { useRef, useState } from 'react'
import { CONTACTS, type Contacts } from '../content.js'

interface ContactActionsProps {
  contacts?: Contacts
  variant?: 'full' | 'compact'
}

export function ContactActions({ contacts, variant = 'full' }: ContactActionsProps) {
  const c = contacts ?? CONTACTS
  const [toast, setToast] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  async function onPhone() {
    if (!c.hasPhone && !(c.phoneReversed && c.phoneReversed.length)) return
    // 号码不预置在页面;点击时才向后端获取
    let phone = c.phoneReversed ? [...c.phoneReversed].reverse().join('') : ''
    if (!phone) {
      try {
        const res = await fetch('/api/contact/phone', { credentials: 'same-origin' })
        if (!res.ok) throw new Error()
        phone = ((await res.json()) as { phone?: string }).phone || ''
      } catch {
        flash('获取电话失败,请改用邮件/微信')
        return
      }
    }
    if (!phone) return flash('暂未提供电话')
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    if (mobile) window.location.href = `tel:${phone}`
    else void copy(phone, '电话已复制到剪贴板')
  }

  function onWechat() {
    if (!c.wechat) return
    void copy(c.wechat, '微信号已复制,请在微信中搜索添加')
  }

  const hasPhone = !!c.hasPhone || !!c.phoneReversed
  const toastEl = toast ? <div className="zx-toast">{toast}</div> : null

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
      </span>
    )
  }

  return (
    <>
      <a className="zx-btn" href={`mailto:${c.email}`}>
        ✉ 邮件
      </a>
      {c.wechat && (
        <button type="button" className="zx-btn" onClick={onWechat} title={`微信号:${c.wechat}`}>
          💬 微信 · {c.wechat}
        </button>
      )}
      {hasPhone && (
        <button type="button" className="zx-btn" onClick={() => void onPhone()} title="点击拨打 / 复制">
          ☎ 电话
        </button>
      )}
      {toastEl}
    </>
  )
}
