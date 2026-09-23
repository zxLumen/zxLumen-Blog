'use client'

import { PreferencesProvider } from './theme-context.js'
import { Topbar } from './Topbar.js'
import { Footer } from './Footer.js'
import { HelpHint } from './HelpHint.js'
import type { Contacts } from '../content.js'
import type { LayoutId } from '../theme.js'
import type { LinkComponent, NavItem } from './types.js'

interface ShellProps {
  nav: NavItem[]
  activeHref?: string
  pathname?: string
  link?: LinkComponent
  contacts?: Contacts
  /** 允许的主题 / 布局(admin 配置的放行集合) */
  allowedThemeIds: string[]
  allowedLayoutIds: LayoutId[]
  /** admin 配置的默认主题 / 布局(须在放行集合内) */
  defaultTheme?: string
  defaultLayout?: LayoutId
  /** 模拟访客身份:主题等偏好按身份分键(等价于一台独立设备) */
  mockId?: string
  extra?: React.ReactNode
  children: React.ReactNode
}

/** 站点外壳:偏好上下文 + 顶栏 + 页脚 + 快捷键提示 */
export function Shell({
  nav,
  activeHref,
  pathname,
  link,
  contacts,
  allowedThemeIds,
  allowedLayoutIds,
  defaultTheme,
  defaultLayout,
  mockId,
  extra,
  children,
}: ShellProps) {
  return (
    <PreferencesProvider
      allowedThemeIds={allowedThemeIds}
      allowedLayoutIds={allowedLayoutIds}
      defaultTheme={defaultTheme}
      defaultLayout={defaultLayout}
      mockId={mockId}
    >
      <div className="zx-app">
        <Topbar nav={nav} activeHref={activeHref} pathname={pathname} link={link} extra={extra} />
        <main className="zx-main">{children}</main>
        <Footer contacts={contacts} />
        <HelpHint />
      </div>
    </PreferencesProvider>
  )
}
