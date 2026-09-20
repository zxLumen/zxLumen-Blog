'use client'

import { useEffect, useRef, useState } from 'react'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize: (s: number) => void
  pageSizeOptions?: number[]
  disabled?: boolean
}

function pageItems(page: number, totalPages: number): (number | '…')[] {
  const out: (number | '…')[] = []
  const push = (v: number | '…') => {
    if (out[out.length - 1] !== v) out.push(v)
  }
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) push(p)
    else push('…')
  }
  return out
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
  pageSizeOptions = [5, 10, 20, 50, 100],
  disabled = false,
}: PaginationProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [jump, setJump] = useState('')
  const sizeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (sizeRef.current && !sizeRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  if (total === 0) return null
  const items = pageItems(page, totalPages)

  function doJump() {
    const n = Number(jump)
    if (Number.isFinite(n) && n >= 1) {
      onPage(Math.min(Math.max(1, Math.floor(n)), totalPages))
    }
    setJump('')
  }

  return (
    <div className={`zx-pager${disabled ? ' is-disabled' : ''}`}>
      <div className="zx-pager-info">
        <span>
          共 <strong>{total}</strong> 条
        </span>
        <div className="zx-pagesize" ref={sizeRef}>
          <button
            type="button"
            className={`zx-pagesize-btn${menuOpen ? ' is-open' : ''}`}
            disabled={disabled}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {pageSize}条/页 <span className="caret">▾</span>
          </button>
          {menuOpen && (
            <div className="zx-pagesize-menu">
              {pageSizeOptions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`zx-pagesize-item${s === pageSize ? ' is-active' : ''}`}
                  onClick={() => {
                    onPageSize(s)
                    setMenuOpen(false)
                  }}
                >
                  {s}条/页
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="zx-pager-btns">
        <button
          type="button"
          className="zx-pagebtn"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="上一页"
        >
          ‹
        </button>
        {items.map((it, i) =>
          it === '…' ? (
            <span key={`e${i}`} className="zx-pagebtn is-ellipsis">
              …
            </span>
          ) : (
            <button
              key={it}
              type="button"
              className={`zx-pagebtn${it === page ? ' is-active' : ''}`}
              disabled={disabled}
              onClick={() => onPage(it)}
            >
              {it}
            </button>
          ),
        )}
        <button
          type="button"
          className="zx-pagebtn"
          disabled={disabled || page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="下一页"
        >
          ›
        </button>
      </div>

      <div className="zx-pager-jump">
        前往
        <input
          className="zx-jump-input"
          inputMode="numeric"
          value={jump}
          disabled={disabled || totalPages <= 1}
          placeholder={String(page)}
          onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') doJump()
          }}
        />
        页
      </div>
    </div>
  )
}
