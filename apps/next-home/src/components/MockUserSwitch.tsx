'use client'

import { useState } from 'react'

const PRESETS = [
  { id: 'mock-alice', label: '访客 A' },
  { id: 'mock-bob', label: '访客 B' },
  { id: 'mock-carol', label: '访客 C' },
]

/** 模拟访客身份(仅测试模式 + 站长):以指定匿名 ID 浏览/留言 */
export function MockUserSwitch({ current }: { current: string }) {
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)

  async function setCid(cid: string) {
    setBusy(true)
    try {
      await fetch('/api/admin/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ cid }),
      })
    } finally {
      window.location.reload()
    }
  }

  return (
    <details className="zx-mock">
      <summary className={`zx-envbtn${current ? ' is-on' : ''}`} title="模拟访客身份(仅测试模式)">
        <span className="zx-envdot" />
        {current ? `MOCK · ${current}` : 'MOCK · 本人'}
      </summary>
      <div className="zx-mockpanel">
        <div className="zx-mock-title">模拟访客身份(仅测试模式)</div>
        <form
          className="zx-mock-row"
          onSubmit={(e) => {
            e.preventDefault()
            const v = val.trim()
            if (v) void setCid(v)
          }}
        >
          <input
            className="zx-input"
            placeholder="mock id(如 mock-alice)"
            value={val}
            maxLength={32}
            onChange={(e) => setVal(e.target.value)}
          />
          <button className="zx-btn zx-btn-sm zx-btn-primary" type="submit" disabled={busy}>
            切换
          </button>
        </form>
        <div className="zx-mock-presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="zx-btn zx-btn-sm zx-btn-ghost"
              disabled={busy}
              onClick={() => void setCid(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {current && (
          <button
            type="button"
            className="zx-btn zx-btn-sm zx-btn-ghost"
            disabled={busy}
            onClick={() => void setCid('')}
          >
            恢复本人
          </button>
        )}
      </div>
    </details>
  )
}
