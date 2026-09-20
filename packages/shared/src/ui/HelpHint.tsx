'use client'

import { usePrefs } from './theme-context.js'

export function HelpHint() {
  const { themeMeta } = usePrefs()
  return (
    <aside className="zx-help" aria-label="快捷键">
      <span className="zx-muted">// 快捷键</span>
      <span className="zoom">
        <kbd className="zx-kbd">1</kbd>–<kbd className="zx-kbd">6</kbd> 主题
      </span>
      <span className="zoom">
        <kbd className="zx-kbd">[</kbd> <kbd className="zx-kbd">]</kbd> 循环主题
      </span>
      <span className="zoom zx-muted">当前 {themeMeta.label}</span>
    </aside>
  )
}
