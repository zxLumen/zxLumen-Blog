'use client'

import { useEffect, type ComponentType, type ReactNode } from 'react'
import type { AppItem } from '../schema.js'
import { isSpaRoute, normalizeUrl } from '../content.js'
import type { AppShot } from './app-shots.js'
import type { LinkComponent } from './types.js'

/**
 * 应用预览：桌面 hover 220ms 的小卡 / 点击后的浮层。
 *
 * 图片一律 loading="lazy"、固定 16:10 画框，浮层与 hover 卡都挂 portal、
 * 用 fixed 定位，不参与文档流 —— 出现/消失不会推挤页面内容。
 */

interface OpenActionProps {
  app: AppItem
  link?: LinkComponent
  onPanelOpen?: (app: AppItem) => void
  /** 关闭预览（打开动作发生后） */
  onDone: () => void
  className?: string
  children?: ReactNode
}

/** 「打开」按钮：完全复用应用栏原有的打开方式（newtab / self / panel） */
export function PreviewOpenAction({
  app,
  link,
  onPanelOpen,
  onDone,
  className = 'zx-apppreview-open',
  children = '打开',
}: OpenActionProps) {
  const href = normalizeUrl(app.url)
  if (!href) return null

  const spa = isSpaRoute(href)
  const panel = (app.openIn ?? 'newtab') === 'panel' && !!onPanelOpen
  const newTab = (app.openIn ?? 'newtab') === 'newtab' && !spa

  if (panel) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => {
          onDone()
          onPanelOpen(app)
        }}
      >
        {children}
      </button>
    )
  }

  if (newTab) {
    return (
      <a className={className} href={href} target="_blank" rel="noreferrer noopener" onClick={onDone}>
        {children}
      </a>
    )
  }

  if (spa) {
    const Comp = (link ?? 'a') as ComponentType<{
      href: string
      className?: string
      onClick?: () => void
      scroll?: boolean
      children: ReactNode
    }>
    return (
      <Comp className={className} href={href} onClick={onDone} {...(link ? { scroll: false } : {})}>
        {children}
      </Comp>
    )
  }

  return (
    <a className={className} href={href} onClick={onDone}>
      {children}
    </a>
  )
}

/** 桌面 hover 预览卡：固定在图标左侧/上方，位置由 AppDock 按图标 rect 现算 */
export function HoverPreview({
  app,
  shot,
  link,
  onPanelOpen,
  onClose,
  onMouseEnter,
  top,
  left,
  side,
}: {
  app: AppItem
  shot: AppShot
  link?: LinkComponent
  onPanelOpen?: (app: AppItem) => void
  onClose: () => void
  onMouseEnter?: () => void
  top: number
  left: number
  side: 'left' | 'top'
}) {
  return (
    <div
      className="zx-apppreview-card zx-apppreview-hover"
      data-side={side}
      role="tooltip"
      style={{ top, left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onClose}
    >
      <div className="zx-apppreview-shot">
        <img src={shot.shot} alt={`${app.name} 预览截图`} loading="lazy" decoding="async" width={1280} height={800} />
      </div>
      <div className="zx-apppreview-meta">
        <strong className="zx-apppreview-name">{app.name}</strong>
        <p className="zx-apppreview-intro">{shot.intro}</p>
        <PreviewOpenAction app={app} link={link} onPanelOpen={onPanelOpen} onDone={onClose} />
      </div>
    </div>
  )
}

/** 点击后的预览浮层：移动端与桌面共用，浮层内再点「打开」才进入应用 */
export function PreviewOverlay({
  app,
  shot,
  link,
  onPanelOpen,
  onClose,
}: {
  app: AppItem
  shot: AppShot
  link?: LinkComponent
  onPanelOpen?: (app: AppItem) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="zx-apppreview" role="dialog" aria-modal="true" aria-label={`${app.name} 应用预览`}>
      <div className="zx-apppreview-backdrop" onClick={onClose} />
      <div className="zx-apppreview-card zx-apppreview-overlay" role="document">
        <button type="button" className="zx-apppreview-close" onClick={onClose} aria-label="关闭预览 (Esc)">
          ✕
        </button>
        <div className="zx-apppreview-shot">
          <img src={shot.shot} alt={`${app.name} 预览截图`} loading="lazy" decoding="async" width={1280} height={800} />
        </div>
        <div className="zx-apppreview-meta">
          <strong className="zx-apppreview-name">{app.name}</strong>
          <p className="zx-apppreview-intro">{shot.intro}</p>
          <PreviewOpenAction
            app={app}
            link={link}
            onPanelOpen={onPanelOpen}
            onDone={onClose}
            className="zx-apppreview-open zx-apppreview-open-lg"
          >
            打开应用
          </PreviewOpenAction>
        </div>
      </div>
    </div>
  )
}
