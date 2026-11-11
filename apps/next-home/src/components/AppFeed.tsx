'use client'

import Link from 'next/link'
import { useCallback, useRef, type MouseEvent } from 'react'
import type { AppItem } from '@zx/shared'
import { normalizeUrl } from '@zx/shared'
import { resolveAppTrack, trackEvent, useAppImpressions, useAppPanel } from '@zx/shared/ui'

export interface FeedCard {
  app: AppItem
  /** 7 天点击率 / 复访率 / 曝光数 */
  ctr: number
  r7: number
  impressions: number
  /** 当前访客累计打开次数 / 上次打开距今天数(null = 没打开过) */
  opens: number
  lastAgo: number | null
  /** 曝光不足 200,还在冷启动池里 */
  cold: boolean
  /** 角标:最常打开 / 探索位(没有数据时都不显示,不硬贴标签) */
  badge?: 'most' | 'explore'
}

/** 曝光少于这个数不展示比例,避免「1 曝光 1 点击 = 100%」误导 */
const MIN_STAT_IMPRESSIONS = 20

function metaText(c: FeedCard): string {
  if (c.opens > 0) {
    if (c.lastAgo === 0) return '今天用过'
    if (c.lastAgo === 1) return '昨天用过'
    return `${c.lastAgo} 天前用过 · 共 ${c.opens} 次`
  }
  if (c.impressions >= MIN_STAT_IMPRESSIONS) {
    return `开 ${Math.round(c.ctr * 100)}% · 复访 ${Math.round(c.r7 * 100)}%`
  }
  return c.cold ? '新卡 · 还没数据' : '还没用过'
}

/**
 * 应用流:`/apps` 的竖向卡片流(主站首屏保持个人主页不变)。
 *
 * 一张卡 = 抖音的一条视频:首屏画面(hook)+ 一句话(tagline)+ 一个动作(action)。
 * 曝光按 `useAppImpressions` 上报(app_impression / 3s 心跳),点击按应用自己的
 * `bind` 规则上报 —— 与右侧应用栏完全同一套口径,不做第二套。
 */
export function AppFeed({ cards }: { cards: FeedCard[] }) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const panel = useAppPanel()
  const apps = cards.map((c) => c.app)

  useAppImpressions(listRef, apps)

  const open = useCallback(
    (e: MouseEvent<HTMLAnchorElement>, app: AppItem) => {
      const { type, target } = resolveAppTrack(app)
      trackEvent(type, target)
      // panel 类应用:站内浮层打开(href 仍保留,中键/复制链接照常可用)
      if (app.openIn === 'panel' && panel) {
        e.preventDefault()
        panel.open(app)
      }
    },
    [panel],
  )

  return (
    <div className="zf">
      <header className="zf-head">
        <p className="zf-kicker">应用 · {cards.length}</p>
        <h1 className="zf-title">一张卡一个应用</h1>
        <p className="zf-sub">
          按点击率和复访率排,不按我喜欢排。每张卡只留 3 秒能看完的信息。
        </p>
      </header>

      <div className="zf-feed" ref={listRef}>
        {cards.map((c, i) => {
          const { app } = c
          const url = normalizeUrl(app.url)
          const external = app.openIn === 'newtab' || /^https?:\/\//.test(app.url)
          return (
            <article className="zf-card" data-app-id={app.id} key={app.id}>
              <a
                className="zf-hit"
                href={url}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener' : undefined}
                onClick={(e) => open(e, app)}
                aria-label={`${app.name}${app.tagline ? ` · ${app.tagline}` : ''}`}
              >
                <div className={`zf-hook${app.hook ? '' : ' is-plain'}`}>
                  {app.hook ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- 站长上传的固定路径小图,不值得走 next/image 的优化管线 */
                    <img
                      className="zf-hook-img"
                      src={app.hook}
                      alt=""
                      loading={i < 2 ? 'eager' : 'lazy'}
                      decoding="async"
                      // 截图还没传 / 404:直接露出下面的图标兜底,不出现破图
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : null}
                  <span className="zf-hook-fallback" aria-hidden="true">
                    {app.icon ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- 图标是 28px 的本地文件 */
                      <img src={app.icon} alt="" />
                    ) : (
                      <span>{app.name.slice(0, 1)}</span>
                    )}
                  </span>
                  {c.badge ? (
                    <span className={`zf-badge${c.badge === 'explore' ? ' is-explore' : ''}`}>
                      {c.badge === 'explore' ? '换个口味' : '最常打开'}
                    </span>
                  ) : null}
                  {app.tags?.length ? (
                    <ul className="zf-tags">
                      {app.tags.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="zf-body">
                  <div className="zf-row">
                    <h2 className="zf-name">{app.name}</h2>
                    <span className="zf-cta">{app.action ?? '打开'}</span>
                  </div>
                  <p className="zf-tagline">{app.tagline ?? '点开看看'}</p>
                  <p className="zf-meta">{metaText(c)}</p>
                </div>
              </a>
            </article>
          )
        })}
      </div>

      <footer className="zf-foot">
        <span>排序:0.5×点击率 + 0.3×复访率 + 0.2×新鲜度,第 4 张固定是探索位</span>
        <Link href="/">← 回主页</Link>
      </footer>
    </div>
  )
}
