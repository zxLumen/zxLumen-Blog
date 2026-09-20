'use client'

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
  pageSizeOptions = [20, 30, 50],
  disabled = false,
}: PaginationProps) {
  if (total === 0) return null
  const items = pageItems(page, totalPages)

  return (
    <div className={`zx-pager${disabled ? ' is-disabled' : ''}`}>
      <div className="zx-pager-info">
        <span>
          共 <strong>{total}</strong> 条 · 第 {page}/{totalPages} 页
        </span>
        <span className="zx-pager-size">
          每页
          {pageSizeOptions.map((s) => (
            <button
              key={s}
              type="button"
              className={`zx-pagebtn${s === pageSize ? ' is-active' : ''}`}
              disabled={disabled}
              onClick={() => onPageSize(s)}
            >
              {s}
            </button>
          ))}
        </span>
      </div>

      <div className="zx-pager-btns">
        <button
          type="button"
          className="zx-pagebtn"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
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
        >
          ›
        </button>
      </div>
    </div>
  )
}
