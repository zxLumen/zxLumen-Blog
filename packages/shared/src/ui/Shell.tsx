'use client'

import { PreferencesProvider } from './theme-context.js'
import { Topbar } from './Topbar.js'
import { Footer } from './Footer.js'
import { HelpHint } from './HelpHint.js'
import type { NavItem } from './types.js'

interface ShellProps {
  nav: NavItem[]
  activeHref?: string
  /** 顶栏右侧插槽(如 测试模式开关) */
  extra?: React.ReactNode
  children: React.ReactNode
}

/** 站点外壳:偏好上下文 + 顶栏 + 页脚 + 快捷键提示 */
export function Shell({ nav, activeHref, extra, children }: ShellProps) {
  return (
    <PreferencesProvider>
      <div className="zx-app">
        <Topbar nav={nav} activeHref={activeHref} extra={extra} />
        <main className="zx-main">{children}</main>
        <Footer />
        <HelpHint />
      </div>
    </PreferencesProvider>
  )
}
