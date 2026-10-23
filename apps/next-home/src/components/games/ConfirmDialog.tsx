'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  /** 当前游戏的主色，portal 到 body 后仍能沿用 */
  accent?: string
  onConfirm: () => void
  onClose: () => void
}

/** 酒桌特殊操作（斋/飞/开/踢人/退出）统一走这个二次确认弹层 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '再想想',
  tone = 'primary',
  busy = false,
  accent,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      window.clearTimeout(timer)
    }
  }, [busy, onClose, open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="game-modal-backdrop"
      role="presentation"
      style={accent ? ({ '--g-accent': accent } as React.CSSProperties) : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="game-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-modal-title"
      >
        <div className="game-modal-kicker">二次确认</div>
        <h2 id="game-modal-title">{title}</h2>
        {description ? <div className="game-modal-body">{description}</div> : null}
        <div className="game-modal-actions">
          <button type="button" className="game-btn ghost" disabled={busy} onClick={onClose}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`game-btn ${tone === 'danger' ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
