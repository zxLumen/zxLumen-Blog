'use client'

import {
  LINKS,
  PROFILE,
  TECH,
  TIMELINE,
  type Contacts,
  type LinkItem,
  type Profile,
  type TechItem,
  type TimelineEntry,
} from '../content.js'
import { Section, useSectionHeader } from './Section.js'
import { ContactActions } from './ContactActions.js'
import { trackEvent } from './track.js'
import { GitHubIcon, MessageIcon } from './icons.js'
import { useEditable, EditControls, InlineText } from './inline-edit.js'
import { useSiteContentSaver } from './SiteContentSaver.js'
import type { SectionHeader } from './site-edit-types.js'

interface AboutValue {
  statusLine: string
  bioLines: string[]
  location: string
  email: string
  wechat: string
  phone: string
  tech: TechItem[]
  timeline: TimelineEntry[]
  links: LinkItem[]
}

export function AboutSection({
  contacts,
  adminContacts,
  profile,
  links,
  tech,
  timeline,
  sectionHeader,
  isAdmin,
}: {
  contacts?: Contacts
  /** 站长:含明文电话,用于就地编辑 */
  adminContacts?: { email?: string; wechat?: string; phone?: string }
  profile?: Profile
  links?: LinkItem[]
  tech?: TechItem[]
  timeline?: TimelineEntry[]
  sectionHeader?: SectionHeader
  isAdmin?: boolean
}) {
  const p = profile ?? PROFILE
  const linksList = links ?? LINKS
  const techList = tech ?? TECH
  const tl = timeline ?? TIMELINE
  const saver = useSiteContentSaver()
  const header = useSectionHeader('about', { tag: '// ABOUT', title: '关于 / 简历' }, sectionHeader)

  const ed = useEditable<AboutValue>(
    {
      statusLine: p.statusLine,
      bioLines: p.bioLines ?? [],
      location: p.location,
      email: adminContacts?.email ?? contacts?.email ?? p.email,
      wechat: adminContacts?.wechat ?? contacts?.wechat ?? '',
      phone: adminContacts?.phone ?? '',
      tech: techList.map((t) => ({ ...t, tags: t.tags ?? [] })),
      timeline: tl.map((t) => ({ ...t })),
      links: linksList.map((l) => ({ ...l })),
    },
    async (v) => {
      if (!saver) throw new Error('保存未就绪')
      await saver.saveContent({
        PROFILE: { statusLine: v.statusLine, bioLines: v.bioLines, location: v.location },
        TECH: v.tech,
        TIMELINE: v.timeline,
        LINKS: v.links,
      })
      await saver.saveContacts({ email: v.email, wechat: v.wechat, phone: v.phone })
    },
  )

  const editing = !!isAdmin && ed.editing
  const v = ed.value
  const github = (editing ? v.links : linksList).find((l) => l.label === 'github')?.url

  const patch = (fn: (s: AboutValue) => AboutValue) => ed.setValue(fn)

  return (
    <Section
      id="about"
      tag={sectionHeader?.tag ?? '// ABOUT'}
      num="03"
      title={sectionHeader?.title ?? '关于 / 简历'}
      edit={isAdmin ? header : undefined}
    >
      {isAdmin && (
        <div className="zx-block-edit">
          <EditControls
            editing={ed.editing}
            dirty={ed.dirty}
            saving={ed.saving}
            error={ed.error}
            onStart={ed.start}
            onCancel={ed.cancel}
            onSave={ed.commit}
            label="编辑关于 / 简历"
          />
        </div>
      )}
      <div className="zx-about-grid">
        <div className="zx-bio">
          <div className="zx-kicker">
            {editing ? (
              <InlineText
                value={v.statusLine}
                onChange={(t) => patch((s) => ({ ...s, statusLine: t }))}
                ariaLabel="状态行"
              />
            ) : (
              p.statusLine
            )}
          </div>

          {(editing ? v.bioLines : p.bioLines).map((l, i) => (
            <p key={i}>
              {editing ? (
                <span className="zx-inline-row">
                  <InlineText
                    multiline
                    value={l}
                    onChange={(t) =>
                      patch((s) => {
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
                    title="删除"
                    aria-label="删除"
                    onClick={() => patch((s) => ({ ...s, bioLines: s.bioLines.filter((_, j) => j !== i) }))}
                  >
                    ×
                  </button>
                </span>
              ) : (
                l
              )}
            </p>
          ))}
          {editing && (
            <button type="button" className="zx-edit-add" onClick={() => patch((s) => ({ ...s, bioLines: [...s.bioLines, ''] }))}>
              + 添加简介行
            </button>
          )}

          <p className="zx-mono zx-dim zx-about-meta">
            {editing ? (
              <InlineText
                value={v.location}
                onChange={(t) => patch((s) => ({ ...s, location: t }))}
                ariaLabel="所在地"
                placeholder="所在地"
              />
            ) : (
              <>
                {p.location} · {contacts?.email ?? p.email}
              </>
            )}
          </p>

          {editing ? (
            <div className="zx-contact-edit">
              <label>
                <span>邮箱</span>
                <InlineText value={v.email} onChange={(t) => patch((s) => ({ ...s, email: t }))} />
              </label>
              <label>
                <span>微信</span>
                <InlineText value={v.wechat} onChange={(t) => patch((s) => ({ ...s, wechat: t }))} />
              </label>
              <label>
                <span>电话</span>
                <InlineText value={v.phone} onChange={(t) => patch((s) => ({ ...s, phone: t }))} />
              </label>
            </div>
          ) : (
            <div className="zx-cta">
              <ContactActions contacts={contacts} />
              {github && (
                <a
                  className="zx-btn zx-btn-ghost"
                  href={github}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => trackEvent('contact_click', 'github')}
                >
                  <span className="zx-ico" aria-hidden="true">
                    <GitHubIcon size={1} />
                  </span>{' '}
                  GitHub
                </a>
              )}
              <a className="zx-btn" href="/resume.pdf" download onClick={() => trackEvent('resume_download')}>
                下载简历 <span className="zx-ico" aria-hidden="true">↓</span>
              </a>
              <a className="zx-btn zx-btn-ghost" href="/#guestbook" onClick={() => trackEvent('contact_click', 'guestbook')}>
                <span className="zx-ico" aria-hidden="true">
                  <MessageIcon size={1} />
                </span>{' '}
                留言
              </a>
            </div>
          )}

          <h3 className="zx-subhead">STACK</h3>
          <div className="zx-tags">
            {(editing ? v.tech : techList).map((t, i) => (
              <span className="zx-badge" key={i}>
                {editing ? (
                  <>
                    <InlineText
                      value={t.name}
                      onChange={(name) =>
                        patch((s) => {
                          const next = s.tech.slice()
                          next[i] = { ...next[i], name }
                          return { ...s, tech: next }
                        })
                      }
                      ariaLabel="技能"
                      placeholder="技能名"
                    />
                    <button
                      type="button"
                      className="zx-edit-x"
                      title="删除技能"
                      aria-label="删除技能"
                      onClick={() => patch((s) => ({ ...s, tech: s.tech.filter((_, j) => j !== i) }))}
                    >
                      ×
                    </button>
                  </>
                ) : (
                  t.name
                )}
              </span>
            ))}
            {editing && (
              <button
                type="button"
                className="zx-edit-add is-chip"
                onClick={() => patch((s) => ({ ...s, tech: [...s.tech, { name: '', level: 0.5, tags: [] }] }))}
              >
                + 技能
              </button>
            )}
          </div>
        </div>

        <div>
          <h3 className="zx-subhead">TIMELINE</h3>
          <div className="zx-timeline">
            {(editing ? v.timeline : tl).map((t, i) => (
              <div className="zx-tl-item" key={i}>
                {editing ? (
                  <div className="zx-tl-edit">
                    <InlineText
                      value={t.period}
                      onChange={(period) =>
                        patch((s) => {
                          const next = s.timeline.slice()
                          next[i] = { ...next[i], period }
                          return { ...s, timeline: next }
                        })
                      }
                      placeholder="时间"
                      ariaLabel="时间"
                    />
                    <InlineText
                      value={t.title}
                      onChange={(title) =>
                        patch((s) => {
                          const next = s.timeline.slice()
                          next[i] = { ...next[i], title }
                          return { ...s, timeline: next }
                        })
                      }
                      placeholder="职位 / 标题"
                      ariaLabel="职位"
                    />
                    <InlineText
                      value={t.org}
                      onChange={(org) =>
                        patch((s) => {
                          const next = s.timeline.slice()
                          next[i] = { ...next[i], org }
                          return { ...s, timeline: next }
                        })
                      }
                      placeholder="组织"
                      ariaLabel="组织"
                    />
                    <span className="zx-inline-row">
                      <InlineText
                        multiline
                        value={t.desc}
                        onChange={(desc) =>
                          patch((s) => {
                            const next = s.timeline.slice()
                            next[i] = { ...next[i], desc }
                            return { ...s, timeline: next }
                          })
                        }
                        placeholder="描述"
                        ariaLabel="描述"
                      />
                      <button
                        type="button"
                        className="zx-edit-x"
                        title="删除这条"
                        aria-label="删除这条"
                        onClick={() => patch((s) => ({ ...s, timeline: s.timeline.filter((_, j) => j !== i) }))}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="zx-tl-period">{t.period}</div>
                    <div className="zx-tl-title">{t.title}</div>
                    <div className="zx-tl-org">{t.org}</div>
                    <div className="zx-tl-desc">{t.desc}</div>
                  </>
                )}
              </div>
            ))}
            {editing && (
              <button
                type="button"
                className="zx-edit-add"
                onClick={() => patch((s) => ({ ...s, timeline: [...s.timeline, { period: '', title: '', org: '', desc: '' }] }))}
              >
                + 时间线条目
              </button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="zx-links-edit">
          <h3 className="zx-subhead">LINKS</h3>
          {v.links.map((l, i) => (
            <span className="zx-inline-row" key={i}>
              <InlineText
                className="zx-inline-w-sm"
                value={l.label}
                onChange={(label) =>
                  patch((s) => {
                    const next = s.links.slice()
                    next[i] = { ...next[i], label }
                    return { ...s, links: next }
                  })
                }
                placeholder="标签"
                ariaLabel="链接标签"
              />
              <InlineText
                value={l.url}
                onChange={(url) =>
                  patch((s) => {
                    const next = s.links.slice()
                    next[i] = { ...next[i], url }
                    return { ...s, links: next }
                  })
                }
                placeholder="https://…"
                ariaLabel="链接地址"
              />
              <button
                type="button"
                className="zx-edit-x"
                title="删除链接"
                aria-label="删除链接"
                onClick={() => patch((s) => ({ ...s, links: s.links.filter((_, j) => j !== i) }))}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" className="zx-edit-add" onClick={() => patch((s) => ({ ...s, links: [...s.links, { label: '', url: '' }] }))}>
            + 链接
          </button>
        </div>
      )}
    </Section>
  )
}
