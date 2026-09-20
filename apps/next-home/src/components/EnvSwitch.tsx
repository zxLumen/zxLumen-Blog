'use client'

import { useState } from 'react'

export function EnvSwitch({ testMode }: { testMode: boolean }) {
  const [busy, setBusy] = useState(false)

  async function call(body: { mode?: 'test' | 'live'; reset?: boolean }) {
    setBusy(true)
    try {
      await fetch('/api/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
    } finally {
      window.location.reload()
    }
  }

  return (
    <div className="zx-envswitch">
      <button
        type="button"
        className={`zx-envbtn${testMode ? ' is-on' : ''}`}
        disabled={busy}
        onClick={() => void call({ mode: testMode ? 'live' : 'test' })}
        title="切换 测试 / 正常 模式(仅站长)"
      >
        <span className="zx-envdot" />
        {testMode ? 'TEST · 测试模式' : 'LIVE · 正常模式'}
      </button>
      {testMode && (
        <button
          type="button"
          className="zx-envreset"
          disabled={busy}
          onClick={() => {
            if (confirm('清空测试库中所有留言?不影响线上数据。')) void call({ reset: true })
          }}
        >
          清空测试库
        </button>
      )}
    </div>
  )
}
