'use client'

import { PreferencesProvider } from './theme-context.js'
import { Topbar } from './Topbar.js'
import { Footer } from './Footer.js'
import { HelpHint } from './HelpHint.js'
import type { LinkComponent, NavItem } from './types.js'

interface ShellProps {
  nav: NavItem[]
  activeHref?: string
  /** 当前路径(App 注入) */
  pathname?: string
  /** 注入式链接组件(如 Next Link) */
  link?: LinkComponent
  /** 顶栏右侧插槽(如 测试模式开关) */
  extra?: React.ReactNode
  children: React.ReactNode
}

/** 站点外壳:偏好上下文 + 顶栏 + 页脚 + 快捷键提示 */
export function Shell({ nav, activeHref, pathname, link, extra, children }: ShellProps) {
  return (
    <PreferencesProvider>
      <div className="zx-app">
        <Topbar nav={nav} activeHref={activeHref} pathname={pathname} link={link} extra={extra} />
        <main className="zx-main">{children}</main>
        <Footer />
        <HelpHint />
      </div>
    </PreferencesProvider>
  )
}
