'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { PROFILE } from '../content.js'
import { ThemePicker } from './ThemePicker.js'
import type { NavItem } from './types.js'

interface TopbarProps {
  nav: NavItem[]
  activeHref?: string
  extra?: React.ReactNode
}

export function Topbar({ nav, activeHref = '/', extra }: TopbarProps) {
  const [pathname, setPathname] = useState(activeHref)
  const [activeHash, setActiveHash] = useState('')

  // 导航里指向页内区块的 id(projects/usage/about/guestbook)
  const sectionIds = useMemo(
    () => nav.map((n) => (n.href.includes('#') ? n.href.split('#')[1] : '')).filter(Boolean),
    [nav],
  )

  // 计算当前高亮:按路径 + 视口内所在区块
  const compute = useCallback(() => {
    setPathname(window.location.pathname || '/')
    let hash = ''
    if (window.location.pathname === '/') {
      for (const id of sectionIds) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 130) hash = '#' + id
      }
    }
    setActiveHash(hash)
  }, [sectionIds])

  const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
  useIsoLayoutEffect(() => {
    compute()
  }, [compute])

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        compute()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('hashchange', onScroll)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('hashchange', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [compute])

  const isActive = (href: string) => {
    if (href.includes('#')) {
      const id = href.split('#')[1]
      return pathname === '/' && activeHash === '#' + id
    }
    if (href === '/') return pathname === '/' && activeHash === ''
    return pathname === href || pathname.startsWith(href + '/')
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
