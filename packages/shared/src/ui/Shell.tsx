'use client'

import { PreferencesProvider } from './theme-context.js'
import { Topbar } from './Topbar.js'
import { Footer } from './Footer.js'
import { HelpHint } from './HelpHint.js'
import type { Contacts } from '../content.js'
import type { LayoutId } from '../theme.js'
import type { FeatureId } from '../features.js'
import type { LinkComponent, NavItem } from './types.js'

interface ShellProps {
  nav: NavItem[]
  activeHref?: string
  pathname?: string
  link?: LinkComponent
  contacts?: Contacts
  /** 允许的主题 / 布局(按模式:正式为精简集,测试为全集) */
  allowedThemeIds: string[]
  allowedLayoutIds: LayoutId[]
  /** 允许的功能(按模式:正式为白名单,测试为全集) */
  allowedFeatures?: FeatureId[]
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
  allowedFeatures,
  extra,
  children,
}: ShellProps) {
  return (
    <PreferencesProvider
      allowedThemeIds={allowedThemeIds}
      allowedLayoutIds={allowedLayoutIds}
      allowedFeatures={allowedFeatures}
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
