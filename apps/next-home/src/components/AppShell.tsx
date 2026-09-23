'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shell } from '@zx/shared/ui'
import type { Contacts, LayoutId, LinkComponent, NavItem } from '@zx/shared/ui'

/**
 * App 侧外壳:把 Next 的 Link、当前路径、联系方式与"可用主题/布局"注入共享 Shell。
 */
export function AppShell({
  nav,
  contacts,
  allowedThemeIds,
  allowedLayoutIds,
  defaultTheme,
  defaultLayout,
  mockId,
  extra,
  children,
}: {
  nav: NavItem[]
  contacts?: Contacts
  allowedThemeIds: string[]
  allowedLayoutIds: LayoutId[]
  /** admin 配置的默认主题 / 布局 */
  defaultTheme?: string
  defaultLayout?: LayoutId
  /** 模拟访客身份:主题等偏好按身份分键 */
  mockId?: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  return (
    <Shell
      nav={nav}
      pathname={pathname}
      link={Link as unknown as LinkComponent}
      contacts={contacts}
      allowedThemeIds={allowedThemeIds}
      allowedLayoutIds={allowedLayoutIds}
      defaultTheme={defaultTheme}
      defaultLayout={defaultLayout}
      mockId={mockId}
      extra={extra}
    >
      {children}
    </Shell>
  )
}
