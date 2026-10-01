'use client'

import { PreferencesProvider } from './theme-context.js'
import { Topbar } from './Topbar.js'
import { Footer } from './Footer.js'
import { ChatWidget } from './ChatWidget.js'
import { AppDock } from './AppDock.js'
import { AppPanelProvider } from './AppPanel.js'
import { AiStatusLight } from './AiStatusLight.js'
import type { AppItem } from '../schema.js'
import type { Contacts, Profile } from '../content.js'
import type { LayoutId } from '../theme.js'
import type { LinkComponent, NavItem } from './types.js'

interface ShellProps {
  nav: NavItem[]
  activeHref?: string
  pathname?: string
  link?: LinkComponent
  contacts?: Contacts
  /** 个人资料(服务端注入;缺省用占位默认) */
  profile?: Profile
  /** 右侧应用栏条目(admin 配置;空数组 = 不渲染) */
  apps?: AppItem[]
  /** 允许的主题 / 布局(admin 配置的放行集合) */
  allowedThemeIds: string[]
  allowedLayoutIds: LayoutId[]
  /** admin 配置的默认主题 / 布局(须在放行集合内) */
  defaultTheme?: string
  defaultLayout?: LayoutId
  /** 模拟访客身份:主题等偏好按身份分键(等价于一台独立设备) */
  mockId?: string
  /** 当前访问者是站长:AI 状态灯额外显示状态文字与逐源明细 */
  admin?: boolean
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
  profile,
  apps,
  allowedThemeIds,
  allowedLayoutIds,
  defaultTheme,
  defaultLayout,
  mockId,
  admin,
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
        <Topbar
          nav={nav}
          activeHref={activeHref}
          pathname={pathname}
          link={link}
          shell={profile?.shell}
          extra={extra}
          bottom={<AiStatusLight admin={admin} />}
        />
        <main className="zx-main">{children}</main>
        <Footer contacts={contacts} name={profile?.name} handle={profile?.handle} />
        <ChatWidget />
        {/* 应用「页内浮层」宿主:挂在应用栏同层,AppDock 通过 context 打开 */}
        <AppPanelProvider apps={apps}>
          <AppDock apps={apps} link={link} mockId={mockId} />
        </AppPanelProvider>
      </div>
    </PreferencesProvider>
  )
}
