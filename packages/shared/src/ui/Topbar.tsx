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
    const path = window.location.pathname || '/'
    setPathname(path)
    let hash = ''
    if (path === '/') {
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
    window.addEventListener('popstate', onScroll)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('hashchange', onScroll)
      window.removeEventListener('popstate', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [compute])

  // 同路由导航(首页 / 及其锚点)在客户端处理,避免整页刷新
  function onNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    const [pathPart, hash] = href.split('#')
    const targetPath = pathPart || '/'
    if (targetPath !== (window.location.pathname || '/')) return // 跨路由:交给浏览器

    e.preventDefault()
    if (hash) {
      document.getElementById(hash)?.scrollIntoView({ behavior: 'auto', block: 'start' })
      window.history.pushState(null, '', href)
      setActiveHash('#' + hash)
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' })
      window.history.pushState(null, '', targetPath)
      setActiveHash('')
    }
  }

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
        <a className="zx-logo" href="/" onClick={(e) => onNavClick(e, '/')}>
          <span className="z">❯</span> {PROFILE.shell}
        </a>
        <nav className="zx-nav">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={(e) => onNavClick(e, item.href)}
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
