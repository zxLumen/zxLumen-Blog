'use client'

/**
 * 内联 SVG 图标(单色,继承 currentColor)。
 * 仓库无图标库,统一在此内联,避免新增依赖。
 */
interface IconProps {
  /** 字号(em),默认 1 */
  size?: number
  /** 固定像素尺寸(优先于 size) */
  px?: number
  className?: string
  title?: string
}

function Svg({
  size = 1,
  px,
  className = 'zx-svg-ico',
  title,
  viewBox = '0 0 24 24',
  children,
}: IconProps & { viewBox?: string; children: React.ReactNode }) {
  const dim = px != null ? `${px}px` : `${size}em`
  return (
    <svg
      className={className}
      width={dim}
      height={dim}
      viewBox={viewBox}
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      style={{ verticalAlign: '-0.14em', display: 'inline-block' }}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

/** 微信(气泡 + 两只眼睛),默认 20×20 */
export function WeChatIcon({ px = 20, ...props }: IconProps) {
  return (
    <Svg px={px} {...props}>
      <path d="M9.5 4C5.36 4 2 6.79 2 10.23c0 1.94 1.08 3.67 2.77 4.82l-.7 2.1 2.46-1.23c.86.24 1.77.37 2.7.37.16 0 .32-.01.48-.02a5.5 5.5 0 0 1-.23-1.57c0-3.2 3.05-5.8 6.81-5.8.16 0 .31 0 .46.02C15.9 6.13 12.98 4 9.5 4Zm-2.6 3.31a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm5.2 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
      <path d="M22 14.7c0-2.8-2.7-5.07-6-5.07s-6 2.27-6 5.07 2.7 5.07 6 5.07c.7 0 1.38-.1 2.01-.28L20.1 20.6l-.56-1.68C21.06 17.97 22 16.45 22 14.7Zm-8.05-1.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm4.1 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
    </Svg>
  )
}

/** GitHub(octocat 简化) */
export function GitHubIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
    </Svg>
  )
}

/** 邮件(信封) */
export function MailIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.4 2L12 12.3 19.6 7H4.4ZM4 8.6V17h16V8.6l-7.4 5.2a1 1 0 0 1-1.2 0L4 8.6Z" />
    </Svg>
  )
}

/** 电话(听筒) */
export function PhoneIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.6 3c.5 0 .95.33 1.1.81l1.02 3.14c.13.4.01.84-.31 1.12L6.9 9.4a12.3 12.3 0 0 0 5.7 5.7l1.33-1.51c.28-.32.72-.44 1.12-.31l3.14 1.02c.48.15.81.6.81 1.1V19c0 .55-.45 1-1 1A15 15 0 0 1 3 6c0-.55.45-1 1-1h2.6Z" />
    </Svg>
  )
}

/** 留言(气泡 + 横线) */
export function MessageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.8l-4.2 3.4A1 1 0 0 1 3 19.6V5a2 2 0 0 1 1-2Zm3 5.5a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2H7Zm0 4a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2H7Z" />
    </Svg>
  )
}
