'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { PROFILE } from '../content.js'
import { ThemePicker } from './ThemePicker.js'
import type { LinkComponent, NavItem } from './types.js'

interface TopbarProps {
  nav: NavItem[]
  activeHref?: string
  /** 由 App 注入的当前路径(Next usePathname);缺省时用 window.location */
  pathname?: string
  /** 注入式链接组件(如 Next 的 Link),缺省用原生 <a> */
  link?: LinkComponent
  extra?: React.ReactNode
}

export function Topbar({
  nav,
  activeHref = '/',
  pathname: pathnameProp,
  link,
  extra,
}: TopbarProps) {
  const [winPath, setWinPath] = useState(activeHref)
  const [activeHash, setActiveHash] = useState('')
  const pathname = pathnameProp ?? winPath

  // 导航里指向页内区块的 id(projects/usage/about/guestbook)
  const sectionIds = useMemo(
    () => nav.map((n) => (n.href.includes('#') ? n.href.split('#')[1] : '')).filter(Boolean),
    [nav],
  )

  // 按路径 + 视口内所在区块计算高亮
  const compute = useCallback(() => {
    const p = pathnameProp ?? (window.location.pathname || '/')
    if (!pathnameProp) setWinPath(p)
    let hash = ''
    if (p === '/') {
      for (const id of sectionIds) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 130) hash = '#' + id
      }
    }
    setActiveHash(hash)
  }, [sectionIds, pathnameProp])

  const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

  // 路由变化后(含客户端导航):滚动到 hash 或顶部;先用 URL hash 兜底高亮,避免先闪 home
  useIsoLayoutEffect(() => {
    const id = (window.location.hash || '').replace(/^#/, '')
    if (id) {
      const el = document.getElementById(id)
      el?.scrollIntoView({ behavior: 'auto', block: 'start' })
      if (sectionIds.includes(id)) setActiveHash('#' + id)
      else setActiveHash('')
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' })
      setActiveHash('')
    }
    // 之后的 scroll 事件会让 compute() 依据实际位置refine
  }, [pathname, sectionIds])

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

  // 同路由(首页 / 及其锚点)在客户端处理;跨路由交给注入的 Link 客户端导航
  function onNavClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    const [pathPart, hash] = href.split('#')
    const targetPath = pathPart || '/'
    if (targetPath !== pathname) return
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

  const Comp = (link ?? 'a') as unknown as React.ComponentType<{
    href: string
    className?: string
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
    scroll?: boolean
    children: React.ReactNode
  }>
  const linkExtra = link ? { scroll: false } : {}

  return (
    <header className="zx-topbar">
      <div className="zx-topbar-in">
        <Comp
          className="zx-logo"
          href="/"
          onClick={(e) => onNavClick(e, '/')}
          {...linkExtra}
        >
          <span className="z">❯</span> {PROFILE.shell}
        </Comp>
        <nav className="zx-nav">
          {nav.map((item) => (
            <Comp
              key={item.href}
              href={item.href}
              onClick={(e) => onNavClick(e, item.href)}
              className={isActive(item.href) ? 'is-active' : undefined}
              {...linkExtra}
            >
              {item.label}
            </Comp>
          ))}
        </nav>
        {extra}
        <ThemePicker />
      </div>
    </header>
  )
}
