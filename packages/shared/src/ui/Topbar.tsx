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
  /** 顶栏 logo 文本(服务端注入;缺省用占位 PROFILE.shell) */
  shell?: string
  extra?: React.ReactNode
  /**
   * 底部插槽(AI 状态灯)。
   *
   * 刻意渲染为 `.zx-topbar-in` 的**兄弟**而不是它的子元素:`.zx-topbar` 在 sidebar
   * 布局下是 `flex-direction:column`(整列左栏),在顶栏布局下是默认 row。同一个
   * 节点挂外层才能让两种形态各走一套 CSS —— sidebar 靠 `margin-top:auto` 顶到列底,
   * 顶栏靠绝对定位出流、居中挂在导航栏下沿(不占高度,`--zx-topbar-h` 不变)。
   */
  bottom?: React.ReactNode
}

/** 由 href 推导航标识:home / projects / usage / about / guestbook / admin */
function navKey(href: string): string {
  if (href.includes('#')) return href.split('#')[1]
  if (href === '/') return 'home'
  return href.replace(/^\//, '').split('/')[0] || 'home'
}

/**
 * 首帧前把顶栏下沿写进 `--zx-topbar-h`。
 *
 * 右上角悬浮件(访客统计 / 服务器状态)的 `top` 依赖这个变量。它本由组件内的
 * `measure()` 维护,但那是被动 useEffect —— **首次绘制之后**才跑,于是首帧变量缺失、
 * 悬浮件按回退值 `0` 出现在全局右上角,随后才「发现上方有菜单栏」跳到其下方
 * (手机顶栏换行后 74~153px,最明显;桌面 ~58px 恰好与回退值相近,看不出来)。
 *
 * 这段 script 紧跟 `</header>` 渲染:HTML 解析到此即**同步执行**,早于首次绘制。
 * 顶栏用系统字体,解析时高度已稳定。之后仍由 `measure()` 在 resize/滚动/换布局时维护。
 * 判定「顶部横条」的方式与 `measure()` 保持一致(排除 sidebar 桌面的整列左栏)。
 */
const TOPBAR_H_INIT = `(function(){try{var b=document.querySelector('.zx-topbar');if(!b)return;var r=b.getBoundingClientRect();var t=r.width>=window.innerWidth*0.85;document.documentElement.style.setProperty('--zx-topbar-h',(t?Math.round(r.bottom):0)+'px');}catch(e){}})()`

export function Topbar({
  nav,
  activeHref = '/',
  pathname: pathnameProp,
  link,
  shell,
  extra,
  bottom,
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
        const line = lineRef.current
        if (el && el.getBoundingClientRect().top <= line) hash = '#' + id
      }
    }
    setActiveHash(hash)
    setNavAttr(p, hash)
  }, [sectionIds, pathnameProp, setNavAttr])

  const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

  /** 顶栏实测高度,用作滚动高亮的判定线。
   *  原先写死 130。改实测后须注意判定线不能只取顶栏高:区块带
   *  scroll-margin-top: 72px,跳转后区块顶边停在 72px,若判定线 < 72,
   *  上一区块(顶边同样在判定线之上)会反过来被选中 —— 表现为导航高亮整体错一位。
   *  故取 max(顶栏高, scroll-margin-top),两者都从 DOM 实测,不再写死。 */
  const barRef = useRef<HTMLElement | null>(null)
  const lineRef = useRef(130)
  /** 顶栏在页面顶端时的下沿(px);供 --zx-topbar-h 与悬浮件定位 */
  const topbarBottomRef = useRef(0)

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
    // 判定线 = max(顶栏实测高, 区块 scroll-margin-top)。两者都随宽度/布局变化
    // (顶栏窄屏换行后约 138px、宽屏 58px;scroll-margin-top 固定 72px),
    // 每次布局变化都要重新量,否则判定线会失准。
    const measure = () => {
      const bar = barRef.current
      const rect = bar?.getBoundingClientRect()
      // 只把「顶部横条」计入顶部占位:sidebar 布局桌面端的顶栏是整列**左栏**
      // (fixed、208px 宽、满视口高),它在左侧不占顶部,其高度既不能当悬浮件的
      // top 偏移,也不能当滚动高亮的判定线(否则判定线 = 视口高,高亮永远停在最后一项)。
      const isTopBar = !!rect && rect.width >= window.innerWidth * 0.85
      // 记录顶栏在**页面顶端**(scrollY≈0)时的下沿:window 布局顶栏上方还有一条
      // 伪窗口栏(●●●),此时下沿更低。滚起来顶栏粘到 top:0、下沿变高,取滚动前的
      // 较大值,悬浮件与判定线在整个滚动过程中都不会压住顶栏。
      if (isTopBar && rect) {
        if (window.scrollY <= 1 || topbarBottomRef.current === 0) {
          topbarBottomRef.current = Math.round(rect.bottom)
        }
      }
      const barH = isTopBar ? topbarBottomRef.current : 0
      document.documentElement.style.setProperty('--zx-topbar-h', barH + 'px')
      let margin = 0
      for (const el of document.querySelectorAll<HTMLElement>('[id]')) {
        const v = parseFloat(getComputedStyle(el).scrollMarginTop)
        if (Number.isFinite(v) && v > 0) { margin = v; break }
      }
      // +1px 余量:scrollIntoView 会把区块顶边停在 scroll-margin-top 上,而落点是
      // 分数滚动偏移,rect.top 常为 72.00000000000001。若判定线恰为 72,
      // `<=` 因浮点误差判假,导航高亮整体错一位(实测桌面宽度必现、窄屏因
      // 判定线被顶栏高拉高而幸免)。留 1px 即可吸收。
      const line = Math.max(barH, margin + 1)
      if (line > 0) lineRef.current = line
    }
    measure()
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
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
    <>
      <header className="zx-topbar" ref={barRef}>
        <div className="zx-topbar-in">
          <Comp className="zx-logo" href="/" onClick={(e) => onNavClick(e, '/')} {...linkExtra}>
            <span className="z">❯</span> {shell ?? PROFILE.shell}
          </Comp>
          <nav className="zx-nav">
            {nav.map((item) =>
              /^https?:\/\//.test(item.href) ? (
                <a key={item.href} href={item.href} target="_blank" rel="noreferrer">
                  {item.label}
                </a>
              ) : (
                <Comp
                  key={item.href}
                  href={item.href}
                  data-nav={navKey(item.href)}
                  onClick={(e) => onNavClick(e, item.href)}
                  {...linkExtra}
                >
                  {item.label}
                </Comp>
              ),
            )}
          </nav>
          {extra}
          <ThemePicker />
        </div>
        {bottom}
      </header>
      <script dangerouslySetInnerHTML={{ __html: TOPBAR_H_INIT }} />
    </>
  )
}
