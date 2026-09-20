'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shell } from '@zx/shared/ui'
import type { Contacts, LinkComponent, NavItem } from '@zx/shared/ui'

/**
 * App 侧外壳:把 Next 的 Link、当前路径与联系方式注入共享 Shell。
 */
export function AppShell({
  nav,
  contacts,
  extra,
  children,
}: {
  nav: NavItem[]
  contacts?: Contacts
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
      extra={extra}
    >
      {children}
    </Shell>
  )
}
