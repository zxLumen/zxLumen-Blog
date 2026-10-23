'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface RenameDialogProps {
  open: boolean
  current: string
  busy: boolean
  accent?: string
  onSave: (name: string) => void
  onClose: () => void
}

export function RenameDialog({ open, current, busy, accent, onSave, onClose }: RenameDialogProps) {
  const [name, setName] = useState(current)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const resetTimer = window.setTimeout(() => setName(current), 0)
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 30)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
      window.clearTimeout(resetTimer)
    }
  }, [busy, current, onClose, open])

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
      <form
        className="game-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-rename-title"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && name.trim()) onSave(name.trim())
        }}
      >
        <div className="game-modal-kicker">房间昵称</div>
        <h2 id="game-rename-title">改个昵称</h2>
        <div className="game-modal-body">
          <input
            ref={inputRef}
            className="game-rename-input"
            value={name}
            maxLength={12}
            onChange={(event) => setName(event.target.value)}
            placeholder="最多 12 个字"
          />
        </div>
        <div className="game-modal-actions">
          <button type="button" className="game-btn ghost" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="game-btn primary" disabled={busy || !name.trim()}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
