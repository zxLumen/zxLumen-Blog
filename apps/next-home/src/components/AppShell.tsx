'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shell } from '@zx/shared/ui'
import type { LinkComponent, NavItem } from '@zx/shared/ui'

/**
 * App 侧外壳:把 Next 的 Link 与当前路径注入共享 Shell,
 * 使跨路由导航也走客户端路由(不整页刷新),并让侧栏高亮实时正确。
 */
export function AppShell({
  nav,
  extra,
  children,
}: {
  nav: NavItem[]
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  return (
    <Shell nav={nav} pathname={pathname} link={Link as unknown as LinkComponent} extra={extra}>
      {children}
    </Shell>
  )
}
