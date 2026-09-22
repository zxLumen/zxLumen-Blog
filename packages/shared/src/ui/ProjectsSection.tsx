'use client'

import { PROJECTS, type Project } from '../content.js'
import { Section } from './Section.js'
import { trackEvent } from './track.js'

const STATUS_LABEL: Record<Project['status'], string> = {
  online: 'ONLINE',
  demo: 'DEMO',
  building: 'BUILDING',
  archived: 'ARCHIVED',
}

function ProjectCard({ project, idx, clicks }: { project: Project; idx: number; clicks?: number }) {
  return (
    <article className={`zx-card${project.featured ? ' is-featured' : ''}`} data-idx={String(idx).padStart(2, '0')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <h3 style={{ margin: 0 }}>{project.name}</h3>
        {clicks !== undefined && clicks > 0 && (
          <span className="zx-project-clicks zx-mono" title="点击次数">
            ▸ {clicks}
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

      {project.highlights && project.highlights.length > 0 && (
        <div style={{ display: 'flex', gap: '1.4rem', margin: '0.2rem 0 0.6rem' }}>
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

      <div className="zx-tags" style={{ marginTop: '0.4rem' }}>
        {project.tech.map((t) => (
          <span className="zx-badge" key={t}>
            {t}
          </span>
        ))}
      </div>

      <div className="zx-card-actions">
        {project.demoUrl && (
          <a
            className="zx-btn zx-btn-sm"
            href={project.demoUrl}
            target={project.demoUrl.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            onClick={() => trackEvent('project_click', project.id)}
          >
            试用 →
          </a>
        )}
        {project.repoUrl && (
          <a
            className="zx-btn zx-btn-sm zx-btn-ghost"
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent('project_click', project.id)}
          >
            repo
          </a>
        )}
      </div>
    </article>
  )
}

export function ProjectsSection({ clicks }: { clicks?: Record<string, number> }) {
  return (
    <Section id="projects" tag="// PROJECTS" num="01" title="项目">
      <div className="zx-grid">
        {PROJECTS.map((p, i) => (
          <ProjectCard key={p.id} project={p} idx={i + 1} clicks={clicks?.[p.id]} />
        ))}
      </div>
    </Section>
  )
}
