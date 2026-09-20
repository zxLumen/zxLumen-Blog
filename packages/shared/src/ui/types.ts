import type { ComponentType, MouseEvent, ReactNode } from 'react'

export interface NavItem {
  label: string
  href: string
}

/** 注入式链接组件(由 App 传入,如 Next 的 Link) */
export interface LinkProps {
  href: string
  className?: string
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  scroll?: boolean
  children: ReactNode
}

export type LinkComponent = ComponentType<LinkProps>
