'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { PROJECTS, normalizeUrl, isExternalUrl, type Project } from '../content.js'
import { Section } from './Section.js'
import { trackEvent } from './track.js'

/** 亮点字号的最小缩放比;低于此值不再缩小,改由省略号兜底 */
const HL_MIN_SCALE = 0.7
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * 亮点(指标)行:始终保持**一行**、按卡片可用宽度自动缩放字号。
 *
 * 纯 CSS 做不到"一行且不断字":中文的 min-content 只有一个字宽,flex 会把
 * 每个指标压扁后逐字断行;而卡片可用宽 = 卡片宽 − 内边距(含常数),字号随
 * 视口缩放也追不平,窄卡片仍会溢出。
 * 这里直接量:把值/标签的 `scrollWidth`(自然宽,不受 flex 收缩影响)与间距相加,
 * 与行宽相比得到缩放比写进 `--hl-scale`,字号与间距同步缩放,自然保持一行。
 * 卡片宽度任何变化(换列数 / 窗口缩放 / 应用栏开关)由 ResizeObserver 重算。
 */
function HighlightRow({ items }: { items: NonNullable<Project['highlights']> }) {
  const rowRef = useRef<HTMLDivElement>(null)

  const fit = () => {
    const row = rowRef.current
    if (!row) return
    const kids = Array.from(row.children) as HTMLElement[]
    if (kids.length === 0) return
    row.style.setProperty('--hl-scale', '1')
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0
    const natural =
      kids.reduce((sum, el) => {
        const v = el.querySelector<HTMLElement>('.zx-highlight-v')?.scrollWidth ?? 0
        const l = el.querySelector<HTMLElement>('.zx-highlight-l')?.scrollWidth ?? 0
        return sum + Math.max(v, l)
      }, 0) +
      gap * (kids.length - 1)
    const avail = row.clientWidth
    if (natural > 0 && avail > 0) {
      const scale = Math.max(HL_MIN_SCALE, Math.min(1, avail / natural))
      row.style.setProperty('--hl-scale', String(scale))
    }
  }

  useIsoLayoutEffect(() => {
    fit()
    const row = rowRef.current
    if (!row) return
    const ro = new ResizeObserver(fit)
    ro.observe(row)
    // 字体就绪后再量一次,避免用回退字体的宽度量偏
    document.fonts?.ready.then(fit).catch(() => {})
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  return (
    <div className="zx-card-highlights" ref={rowRef}>
      {items.map((h) => (
        <div className="zx-highlight" key={h.label}>
          <div className="zx-mono zx-accent zx-highlight-v">{h.value}</div>
          <div className="zx-muted zx-mono zx-highlight-l">{h.label}</div>
        </div>
      ))}
    </div>
  )
}

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
          <HighlightRow items={project.highlights} />
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
