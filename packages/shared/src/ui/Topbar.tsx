'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { PROFILE } from '../content.js'
import { ThemePicker } from './ThemePicker.js'
import type { NavItem } from './types.js'

interface TopbarProps {
  nav: NavItem[]
  activeHref?: string
  extra?: React.ReactNode
}

export function Topbar({ nav, activeHref = '/', extra }: TopbarProps) {
  const [path, setPath] = useState(activeHref)

  const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
  useIsoLayoutEffect(() => {
    setPath(window.location.pathname || '/')
  }, [])

  const isActive = (href: string) => {
    // 锚点导航(如 /#projects)不参与选中高亮
    if (href.includes('#')) return false
    if (href === '/') return path === '/'
    return path === href || path.startsWith(href + '/')
  }

  return (
    <header className="zx-topbar">
      <div className="zx-topbar-in">
        <a className="zx-logo" href="/">
          <span className="z">❯</span> {PROFILE.shell}
        </a>
        <nav className="zx-nav">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={isActive(item.href) ? 'is-active' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        {extra}
        <ThemePicker />
      </div>
    </header>
  )
}
