'use client'

import { usePrefs } from './theme-context.js'

export function HelpHint() {
  const { themeMeta, layoutMeta, themes, layouts } = usePrefs()
  const firstThemeKey = themes[0]?.key ?? '1'
  const lastThemeKey = themes[themes.length - 1]?.key ?? '6'
  return (
    <aside className="zx-help" aria-label="快捷键">
      <span className="zx-muted">// 快捷键</span>
      <span className="zoom">
        <kbd className="zx-kbd">{firstThemeKey}</kbd>–<kbd className="zx-kbd">{lastThemeKey}</kbd> 主题
        {layouts.length > 1 && (
          <>
            {' · '}
            <kbd className="zx-kbd">⇧1</kbd>–<kbd className="zx-kbd">⇧0</kbd> 布局
          </>
        )}
      </span>
      <span className="zoom">
        <kbd className="zx-kbd">[</kbd> <kbd className="zx-kbd">]</kbd> 循环主题
      </span>
      <span className="zoom zx-muted">
        当前 {themeMeta.label}
        {layouts.length > 1 ? ` · ${layoutMeta.label}` : ''}
      </span>
    </aside>
  )
}
