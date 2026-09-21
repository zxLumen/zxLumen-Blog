'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const PRESETS = [
  { id: 'mock-alice', label: '访客 A', color: '#4ade80' },
  { id: 'mock-bob', label: '访客 B', color: '#38bdf8' },
  { id: 'mock-carol', label: '访客 C', color: '#f472b6' },
]

const ID_RE = /^[a-z0-9_-]{1,32}$/

interface Pos {
  top: number
  left: number
  right: string
  width: number
}

interface MockRow {
  id: string
  label: string
  hint: string
  color: string
}

/** 模拟访客身份(仅测试模式 + 站长):以指定匿名 ID 浏览/留言 */
export function MockUserSwitch({ current }: { current: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState('')
  const [pos, setPos] = useState<Pos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // 依按钮位置计算 fixed 坐标:优先右侧(sidebar 场景),否则向下(顶部场景)
  const place = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const width = Math.min(300, vw - 32)
    let left = r.right + 10
    let top = r.top
    if (left + width > vw - 12) {
      left = Math.max(12, Math.min(r.left, vw - width - 12))
      top = r.bottom + 8
    }
    setPos({ top, left, right: 'auto', width })
  }, [])

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
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
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

  async function apply(cid: string) {
    setBusy(true)
    try {
      await fetch('/api/admin/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cid }),
      })
    } finally {
      // 整页刷新,保证 SSR 与接口两侧一致
      window.location.reload()
    }
  }

  function submitCustom() {
    const id = custom.trim()
    if (!id) {
      setError('请输入访客 ID')
      return
    }
    if (!ID_RE.test(id)) {
      setError('仅限 1-32 位小写字母/数字/_/-')
      return
    }
    setError('')
    void apply(id)
  }

  const activePreset = PRESETS.find((p) => p.id === current)
  const curLabel = current ? (activePreset ? activePreset.label : current) : '本人'

  const rows: MockRow[] = [
    { id: '', label: '站长 · 本人', hint: '@zxl', color: 'var(--accent)' },
    ...PRESETS.map((p) => ({ id: p.id, label: p.label, hint: `@${p.id}`, color: p.color })),
  ]
  if (current && !activePreset) {
    rows.push({ id: current, label: current, hint: '自定义', color: '#eab308' })
  }

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popRef}
            className="zx-pop zx-pop-fixed zx-mockpop"
            style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, width: pos.width }}
          >
            <div className="zx-mockpop-head">
              <span className="zx-mockpop-tag">{'// MOCK USER'}</span>
              <span className={`zx-mockpop-status${current ? ' is-on' : ''}`}>
                {current ? `模拟中 · @${current}` : '身份 · 本人'}
              </span>
            </div>

            <div className="zx-mockpop-list">
              {rows.map((row) => (
                <button
                  key={row.id || '__me__'}
                  type="button"
                  className={`zx-mockrow${current === row.id ? ' is-active' : ''}`}
                  disabled={busy}
                  onClick={() => void apply(row.id)}
                >
                  <span className="zx-mockrow-avatar" style={{ background: row.color }} />
                  <span className="zx-mockrow-label">{row.label}</span>
                  <span className="zx-mockrow-hint">{row.hint}</span>
                  {current === row.id && <span className="zx-mockrow-check">✓</span>}
                </button>
              ))}
            </div>

            <div className="zx-mockpop-custom">
              <span className="zx-mockpop-tag">CUSTOM</span>
              <div className="zx-mockpop-cli">
                <span className="zx-mockpop-dollar">$</span>
                <input
                  className="zx-mockpop-in"
                  value={custom}
                  placeholder="输入自定义 ID"
                  maxLength={32}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCustom()
                  }}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="zx-mockpop-go"
                  disabled={busy}
                  onClick={submitCustom}
                >
                  切换
                </button>
              </div>
              {error && <div className="zx-mockpop-error">{error}</div>}
              <div className="zx-mockpop-hint">1-32 位小写字母/数字/_/-(空 = 恢复本人)</div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`zx-mockbtn${current ? ' is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="模拟访客身份(仅测试模式)"
      >
        <span className="zx-envdot" />
        <span className="zx-mockbtn-label">
          MOCK<span className="zx-mockbtn-sep">·</span>
          <span className="zx-mockbtn-cur">{curLabel}</span>
        </span>
        <span className="zx-mockbtn-caret">▾</span>
      </button>
      {popover}
    </>
  )
}