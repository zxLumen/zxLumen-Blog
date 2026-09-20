'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

/** 由 href 推导航标识:home / projects / usage / about / guestbook / admin */
function navKey(href: string): string {
  if (href.includes('#')) return href.split('#')[1]
  if (href === '/') return 'home'
  return href.replace(/^\//, '').split('/')[0] || 'home'
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

  const sectionIds = useMemo(
    () => nav.map((n) => (n.href.includes('#') ? n.href.split('#')[1] : '')).filter(Boolean),
    [nav],
  )

  // 设置 <html data-nav>(CSS 据此高亮;首帧由内联脚本先设好)
  const setNavAttr = useCallback(
    (p: string, hash: string) => {
      let v = 'home'
      if (p !== '/') {
        v = p.replace(/^\//, '').split('/')[0] || 'home'
      } else {
        const id = (hash || '').replace(/^#/, '')
        v = sectionIds.includes(id) ? id : 'home'
      }
      document.documentElement.dataset.nav = v
    },
    [sectionIds],
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
    setNavAttr(p, hash)
  }, [sectionIds, pathnameProp, setNavAttr])

  const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

  // 路由变化后(含客户端导航):滚动到 hash 或顶部;先用 URL hash 定高亮,避免先闪 home
  useIsoLayoutEffect(() => {
    const id = (window.location.hash || '').replace(/^#/, '')
    if (id) {
      setActiveHash(sectionIds.includes(id) ? '#' + id : '')
      setNavAttr(pathname, sectionIds.includes(id) ? '#' + id : '')
      const scroll = () =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' })
      scroll()
      const raf = requestAnimationFrame(scroll)
      return () => cancelAnimationFrame(raf)
    }
    window.scrollTo({ top: 0, behavior: 'auto' })
    setActiveHash('')
    setNavAttr(pathname, '')
  }, [pathname, sectionIds, setNavAttr])

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

  // 首页滚动时把当前区块同步到地址栏 hash(用 replaceState,不堆历史、不触发 hashchange)
  const sawHashRef = useRef(false)
  useEffect(() => {
    if (pathname !== '/') return
    if (activeHash) sawHashRef.current = true
    if (!sawHashRef.current && !activeHash && window.location.hash) return
    const target = pathname + (activeHash || '')
    if (window.location.pathname + window.location.hash !== target) {
      window.history.replaceState(null, '', target)
    }
  }, [activeHash, pathname])

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
      document.documentElement.dataset.nav = hash
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' })
      window.history.pushState(null, '', targetPath)
      setActiveHash('')
      document.documentElement.dataset.nav = 'home'
    }
  }

  const Comp = (link ?? 'a') as unknown as React.ComponentType<{
    href: string
    className?: string
    'data-nav'?: string
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
    scroll?: boolean
    children: React.ReactNode
  }>
  const linkExtra = link ? { scroll: false } : {}

  return (
    <header className="zx-topbar">
      <div className="zx-topbar-in">
        <Comp className="zx-logo" href="/" onClick={(e) => onNavClick(e, '/')} {...linkExtra}>
          <span className="z">❯</span> {PROFILE.shell}
        </Comp>
        <nav className="zx-nav">
          {nav.map((item) => (
            <Comp
              key={item.href}
              href={item.href}
              data-nav={navKey(item.href)}
              onClick={(e) => onNavClick(e, item.href)}
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
