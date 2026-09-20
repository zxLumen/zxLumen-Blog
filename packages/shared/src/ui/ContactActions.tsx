'use client'

import { useRef, useState } from 'react'
import { CONTACTS } from '../content.js'

interface ContactActionsProps {
  variant?: 'full' | 'compact'
}

export function ContactActions({ variant = 'full' }: ContactActionsProps) {
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

  const phone = CONTACTS.phoneReversed ? [...CONTACTS.phoneReversed].reverse().join('') : ''

  function onPhone() {
    if (!phone) return
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    if (mobile) {
      // 移动端直接拨号(不显示号码)
      window.location.href = `tel:${phone}`
    } else {
      void copy(phone, '电话已复制到剪贴板')
    }
  }

  function onWechat() {
    if (!CONTACTS.wechat) return
    void copy(CONTACTS.wechat, '微信号已复制,请在微信中搜索添加')
  }

  const toastEl = toast ? <div className="zx-toast">{toast}</div> : null

  if (variant === 'compact') {
    return (
      <span className="zx-contact-compact">
        <a href={`mailto:${CONTACTS.email}`}>邮件</a>
        {CONTACTS.wechat && <button type="button" className="zx-linkbtn" onClick={onWechat}>微信</button>}
        {phone && <button type="button" className="zx-linkbtn" onClick={onPhone}>电话</button>}
        {toastEl}
      </span>
    )
  }

  return (
    <>
      <a className="zx-btn" href={`mailto:${CONTACTS.email}`}>
        ✉ 邮件
      </a>
      {CONTACTS.wechat && (
        <button type="button" className="zx-btn" onClick={onWechat} title={`微信号:${CONTACTS.wechat}`}>
          💬 微信 · {CONTACTS.wechat}
        </button>
      )}
      {phone && (
        <button type="button" className="zx-btn" onClick={onPhone} title="点击拨打 / 复制">
          ☎ 电话
        </button>
      )}
      {toastEl}
    </>
  )
}
