'use client'

import { useRef } from 'react'
import { PROFILE, type Profile } from '../content.js'
import type { VlogSeries, VlogStart } from '../schema.js'
import { usePrefs } from './theme-context.js'
import { Typewriter } from './Typewriter.js'
import { HeroVlog } from './HeroVlog.js'

interface HeroProps {
  /** 个人资料(服务端注入运行时内容;缺省用占位默认) */
  profile?: Profile
  /** 抖音旅行短视频系列(admin 配置;有则右侧播放器替换 ASCII) */
  vlogSeries?: VlogSeries[]
  /** 首页随机起播点(服务端随机) */
  vlogStart?: VlogStart | null
  /** 主 CTA 链接 / 次 CTA 链接 / 第三 CTA 链接 */
  primaryHref?: string
  primaryLabel?: string
  secondaryHref?: string
  secondaryLabel?: string
  tertiaryHref?: string
  tertiaryLabel?: string
}

/** 隐藏彩蛋:快速连点名字/ASCII 框 4 次进入 admin */
const SECRET_CLICKS = 4
const SECRET_WINDOW = 1200

export function Hero({
  profile,
  vlogSeries,
  vlogStart,
  primaryHref = '/#projects',
  primaryLabel = '查看项目 →',
  secondaryHref = '/#usage',
  secondaryLabel = 'Token用量',
  tertiaryHref = '/#about',
  tertiaryLabel = '关于 / 简历',
}: HeroProps) {
  const p = profile ?? PROFILE
  const { themeMeta: meta } = usePrefs()
  const clicks = useRef<number[]>([])

  function onMotifClick() {
    const now = Date.now()
    clicks.current = [...clicks.current.filter((t) => now - t < SECRET_WINDOW), now]
    if (clicks.current.length >= SECRET_CLICKS) {
      clicks.current = []
      window.location.assign('/admin')
    }
  }

  const hasVlog = !!vlogSeries && vlogSeries.length > 0

  return (
    <section className="zx-hero">
      <div className="zx-container zx-hero-grid">
        <div className="zx-rise">
          <div className="zx-kicker">{p.title}</div>
          <h1 onClick={onMotifClick}>{p.name}</h1>
          <div className="zx-hero-sub">
            <Typewriter text={meta.heroLine} />
          </div>
          <div className="zx-hero-body">
            {p.bioLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="zx-cta">
            <a className="zx-btn zx-btn-primary" href={primaryHref}>
              {primaryLabel}
            </a>
            <a className="zx-btn zx-btn-ghost" href={secondaryHref}>
              {secondaryLabel}
            </a>
            <a className="zx-btn zx-btn-ghost" href={tertiaryHref}>
              {tertiaryLabel}
            </a>
          </div>
        </div>
        {hasVlog ? (
          <HeroVlog series={vlogSeries} start={vlogStart ?? undefined} />
        ) : (
          <pre
            className="zx-ascii zx-rise"
            aria-hidden="true"
            onClick={onMotifClick}
            title=""
          >
            {meta.motif}
            {'\n'}
            <span className="zx-caret" />
          </pre>
        )}
      </div>
    </section>
  )
}
