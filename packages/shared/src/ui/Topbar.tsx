'use client'

import { PROFILE } from '../content.js'
import { ThemePicker } from './ThemePicker.js'
import type { NavItem } from './types.js'

interface TopbarProps {
  nav: NavItem[]
  activeHref?: string
  extra?: React.ReactNode
}

export function Topbar({ nav, activeHref = '/', extra }: TopbarProps) {
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
              className={item.href === activeHref ? 'is-active' : undefined}
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
