'use client'

import { useState } from 'react'
import { PROFILE, type Profile } from '../content.js'
import type { VlogSeries, VlogStart } from '../schema.js'
import { usePrefs } from './theme-context.js'
import { Typewriter } from './Typewriter.js'
import { HeroVlog } from './HeroVlog.js'
import { useEditable, EditControls, InlineText } from './inline-edit.js'
import { useSiteContentSaver } from './SiteContentSaver.js'

interface HeroProps {
  /** 个人资料(服务端注入运行时内容;缺省用占位默认) */
  profile?: Profile
  /** SEO 站点信息(标题 / 描述) */
  siteMeta?: { title?: string; description?: string }
  /** 站长:显示就地编辑 */
  isAdmin?: boolean
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

/** 隐藏入口:单击首屏姓名进 admin(/admin 本身有密码保护) */
function enterAdmin() {
  window.location.assign('/admin')
}

interface HeroValue {
  title: string
  name: string
  bioLines: string[]
  siteTitle: string
  siteDescription: string
}

export function Hero({
  profile,
  siteMeta,
  isAdmin,
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
  const saver = useSiteContentSaver()
  const [showSeo, setShowSeo] = useState(false)

  const ed = useEditable<HeroValue>(
    {
      title: p.title,
      name: p.name,
      bioLines: p.bioLines ?? [],
      siteTitle: siteMeta?.title ?? '',
      siteDescription: siteMeta?.description ?? '',
    },
    async (v) => {
      if (!saver) throw new Error('保存未就绪')
      await saver.saveContent({
        PROFILE: { name: v.name, title: v.title, bioLines: v.bioLines },
        SITE_META: { title: v.siteTitle, description: v.siteDescription },
      })
    },
  )
  const editing = !!isAdmin && ed.editing
  const v = isAdmin ? ed.value : { ...ed.value, title: p.title, name: p.name, bioLines: p.bioLines ?? [] }

  const hasVlog = !!vlogSeries && vlogSeries.length > 0

  return (
    <section className="zx-hero">
      <div className={`zx-container zx-hero-grid${hasVlog ? ' zx-hero-grid--vlog' : ''}`}>
        {isAdmin && (
          <div className="zx-hero-edit">
            <EditControls
              editing={ed.editing}
              dirty={ed.dirty}
              saving={ed.saving}
              error={ed.error}
              onStart={ed.start}
              onCancel={() => {
                setShowSeo(false)
                ed.cancel()
              }}
              onSave={ed.commit}
              label="编辑个人资料"
            />
          </div>
        )}
        <div className="zx-rise">
          <div className="zx-kicker">
            {editing ? (
              <InlineText value={v.title} onChange={(t) => ed.setValue((s) => ({ ...s, title: t }))} ariaLabel="标题" />
            ) : (
              v.title
            )}
          </div>
          {/* 隐藏入口:只让「名字本身」可点(span 无背景,不影响 h1 的渐变文字) */}
          <h1>
            {editing ? (
              <InlineText
                className="zx-inline-hero"
                value={v.name}
                onChange={(t) => ed.setValue((s) => ({ ...s, name: t }))}
                ariaLabel="名字"
              />
            ) : (
              <span className="zx-hero-name" onClick={enterAdmin}>
                {v.name}
              </span>
            )}
          </h1>
          <div className="zx-hero-sub">
            <Typewriter text={meta.heroLine} />
          </div>
          <div className="zx-hero-body">
            {v.bioLines.map((line, i) => (
              <p key={i}>
                {editing ? (
                  <span className="zx-inline-row">
                    <InlineText
                      multiline
                      value={line}
                      onChange={(t) =>
                        ed.setValue((s) => {
                          const next = s.bioLines.slice()
                          next[i] = t
                          return { ...s, bioLines: next }
                        })
                      }
                      ariaLabel="简介"
                    />
                    <button
                      type="button"
                      className="zx-edit-x"
                      title="删除这一行"
                      aria-label="删除这一行"
                      onClick={() => ed.setValue((s) => ({ ...s, bioLines: s.bioLines.filter((_, j) => j !== i) }))}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  line
                )}
              </p>
            ))}
            {editing && (
              <button
                type="button"
                className="zx-edit-add"
                onClick={() => ed.setValue((s) => ({ ...s, bioLines: [...s.bioLines, ''] }))}
              >
                + 添加简介行
              </button>
            )}
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

          {editing && (
            <div className="zx-seo-block">
              <button type="button" className="zx-edit-add" onClick={() => setShowSeo((s) => !s)}>
                {showSeo ? '▾' : '▸'} 站点信息(SEO)
              </button>
              {showSeo && (
                <div className="zx-seo-fields">
                  <label>
                    <span>标题</span>
                    <InlineText value={v.siteTitle} onChange={(t) => ed.setValue((s) => ({ ...s, siteTitle: t }))} />
                  </label>
                  <label>
                    <span>描述</span>
                    <InlineText
                      multiline
                      value={v.siteDescription}
                      onChange={(t) => ed.setValue((s) => ({ ...s, siteDescription: t }))}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
        {hasVlog ? (
          <HeroVlog series={vlogSeries} start={vlogStart ?? undefined} />
        ) : (
          <pre className="zx-ascii zx-rise" aria-hidden="true" title="">
            {meta.motif}
            {'\n'}
            <span className="zx-caret" />
          </pre>
        )}
      </div>
    </section>
  )
}
