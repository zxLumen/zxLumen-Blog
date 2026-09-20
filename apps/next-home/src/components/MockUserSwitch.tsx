'use client'

import { useState } from 'react'

const PRESETS = [
  { id: 'mock-alice', label: '访客 A' },
  { id: 'mock-bob', label: '访客 B' },
  { id: 'mock-carol', label: '访客 C' },
]

/** 模拟访客身份(仅测试模式 + 站长):以指定匿名 ID 浏览/留言 */
export function MockUserSwitch({ current }: { current: string }) {
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

  const known = PRESETS.some((p) => p.id === current)

  return (
    <label className={`zx-mocksel${current ? ' is-on' : ''}`} title="模拟访客身份(仅测试模式)">
      <span className="zx-envdot" />
      <select
        value={current}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__custom__') {
            const id = window.prompt('输入模拟访客 ID(1-32 位小写字母/数字/_/-)', '')
            if (id && id.trim()) void setCid(id.trim())
            else e.target.value = current
            return
          }
          void setCid(v)
        }}
      >
        <option value="">MOCK · 本人</option>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            MOCK · {p.label}
          </option>
        ))}
        {current && !known && <option value={current}>MOCK · {current}</option>}
        <option value="__custom__">MOCK · 自定义…</option>
      </select>
    </label>
  )
}
