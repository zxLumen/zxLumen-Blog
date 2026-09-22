'use client'

import { LINKS, PROFILE, TECH, TIMELINE, type Contacts } from '../content.js'
import { Section } from './Section.js'
import { ContactActions } from './ContactActions.js'
import { trackEvent } from './track.js'

export function AboutSection({ contacts }: { contacts?: Contacts }) {
  const github = LINKS.find((l) => l.label === 'github')?.url
  return (
    <Section id="about" tag="// ABOUT" num="04" title="关于 / 简历">
      <div className="zx-about-grid">
        <div className="zx-bio">
          <div className="zx-kicker">{PROFILE.statusLine}</div>
          {PROFILE.bioLines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          <p className="zx-mono zx-dim" style={{ fontSize: '0.8rem' }}>
            {PROFILE.location} · {PROFILE.email}
          </p>
          <div className="zx-cta">
            <ContactActions contacts={contacts} />
            {github && (
              <a className="zx-btn zx-btn-ghost" href={github} target="_blank" rel="noreferrer">
                GitHub <span className="zx-ico" aria-hidden="true">↗</span>
              </a>
            )}
            <a className="zx-btn" href="/resume.pdf" download onClick={() => trackEvent('resume_download')}>
              下载简历 <span className="zx-ico" aria-hidden="true">↓</span>
            </a>
            <a className="zx-btn zx-btn-ghost" href="/#guestbook">
              留言
            </a>
          </div>

          <h3 className="zx-mono" style={{ marginTop: '2rem', fontSize: '0.9rem' }}>
            STACK
          </h3>
          <div className="zx-tags" style={{ marginTop: '0.7rem' }}>
            {PROFILE && TECH.map((t) => (
              <span className="zx-badge" key={t.name}>
                {t.name}
              </span>
            ))}
          </div>
        </div>

        <div>
          <h3 className="zx-mono" style={{ fontSize: '0.9rem', marginBottom: '1.2rem' }}>
            TIMELINE
          </h3>
          <div className="zx-timeline">
            {TIMELINE.map((t) => (
              <div className="zx-tl-item" key={t.period + t.title}>
                <div className="zx-tl-period">{t.period}</div>
                <div className="zx-tl-title">{t.title}</div>
                <div className="zx-tl-org">{t.org}</div>
                <div className="zx-tl-desc">{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}
