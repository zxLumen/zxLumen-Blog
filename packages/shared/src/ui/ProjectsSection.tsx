'use client'

import { PROJECTS, normalizeUrl, isExternalUrl, type Project } from '../content.js'
import { Section } from './Section.js'
import { trackEvent } from './track.js'

const STATUS_LABEL: Record<Project['status'], string> = {
  online: 'ONLINE',
  demo: 'DEMO',
  building: 'BUILDING',
  archived: 'ARCHIVED',
}

function ProjectCard({
  project,
  idx,
  clicks,
  pv,
}: {
  project: Project
  idx: number
  clicks?: number
  pv?: number
}) {
  // 本站项目(「本页 · 个人主页」):只显示全站访问量(PV),不计链接点击
  const self = project.demoUrl === '/'
  const demoUrl = normalizeUrl(project.demoUrl)
  const repoUrl = normalizeUrl(project.repoUrl)
  const total = self ? pv ?? 0 : clicks ?? 0
  return (
    <article
      className={`zx-card${project.featured ? ' is-featured' : ''}${project.status === 'archived' ? ' is-archived' : ''}`}
      data-idx={String(idx).padStart(2, '0')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <h3 style={{ margin: 0 }}>{project.name}</h3>
        {total > 0 && (
          <span
            className="zx-project-clicks"
            title={self ? '全站访问量' : '链接点击次数'}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 4l7 16 2.5-6.5L20 11 4 4z" />
            </svg>
            {total} 次点击
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <span className="zx-status" data-status={project.status}>
          {STATUS_LABEL[project.status]}
        </span>
        {project.period && (
          <span className="zx-mono zx-muted" style={{ fontSize: '0.68rem' }}>
            {project.period}
          </span>
        )}
      </div>
      <p style={{ marginTop: '0.7rem' }}>{project.desc}</p>

      <div className="zx-card-bottom">
        {project.highlights && project.highlights.length > 0 && (
          <div style={{ display: 'flex', gap: '1.4rem', margin: '0 0 0.6rem' }}>
            {project.highlights.map((h) => (
              <div key={h.label}>
                <div className="zx-mono zx-accent" style={{ fontSize: '1.05rem', fontWeight: 700 }}>
                  {h.value}
                </div>
                <div className="zx-muted zx-mono" style={{ fontSize: '0.66rem', textTransform: 'uppercase' }}>
                  {h.label}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="zx-tags">
          {project.tech.map((t) => (
            <span className="zx-badge" key={t}>
              {t}
            </span>
          ))}
        </div>

        <div className="zx-card-actions">
          {demoUrl && (
            <a
              className="zx-btn zx-btn-sm"
              href={demoUrl}
              target={isExternalUrl(demoUrl) ? '_blank' : undefined}
              rel="noreferrer"
              onClick={() => trackEvent('project_click', project.id)}
            >
              试用 →
            </a>
          )}
          {repoUrl && (
            <a
              className="zx-btn zx-btn-sm zx-btn-ghost"
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackEvent('project_click', project.id)}
            >
              repo
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

export function ProjectsSection({
  projects = PROJECTS,
  clicks,
  pv,
}: {
  projects?: Project[]
  clicks?: Record<string, number>
  pv?: number
}) {
  // 分类:显式 kind 优先,缺省按本站(demoUrl='/')推断
  const kindOf = (p: Project): 'personal' | 'work' => p.kind ?? (p.demoUrl === '/' ? 'personal' : 'work')
  const personal = projects.filter((p) => kindOf(p) === 'personal')
  const work = projects.filter((p) => kindOf(p) === 'work')
  return (
    <Section id="projects" tag="// PROJECTS" num="01" title="项目">
      {personal.length > 0 && (
        <div className="zx-grid">
          {personal.map((p, i) => (
            <ProjectCard key={p.id} project={p} idx={i + 1} clicks={clicks?.[p.id]} pv={pv} />
          ))}
        </div>
      )}
      {work.length > 0 && (
        <>
          {personal.length > 0 && <div className="zx-projects-sep" aria-hidden="true" />}
          <div className="zx-grid">
            {work.map((p, i) => (
              <ProjectCard key={p.id} project={p} idx={personal.length + i + 1} clicks={clicks?.[p.id]} pv={pv} />
            ))}
          </div>
        </>
      )}
    </Section>
  )
}
