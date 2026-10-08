'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PROJECTS, normalizeUrl, isExternalUrl, type Project } from '../content.js'
import type { StoredProject } from '../schema.js'
import { Section } from './Section.js'
import { trackEvent } from './track.js'
import { useDragReorder } from './useDragReorder.js'
import { reorderVisible } from './projects-order.js'
import { adminFetch } from './admin/admin-fetch.js'

/** 亮点字号的最小缩放比;缩到该值仍放不下时改为换行(不用省略号) */
const HL_MIN_SCALE = 0.7
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * 亮点(指标)行:优先保持**一行**、按卡片可用宽度自动缩放字号;缩到下限仍放不下
 * 就整块**换行**(不使用省略号)。
 *
 * 纯 CSS 做不到"一行且不断字":中文的 min-content 只有一个字宽,flex 会把每个指标
 * 压扁后逐字断行;而卡片可用宽 = 卡片宽 − 内边距(含常数),字号随视口缩放也追不平。
 * 这里直接量:把值/标签的 `scrollWidth`(自然宽,不受 flex 收缩影响)与间距相加,
 * 与行宽相比得到缩放比写进 `--hl-scale`,字号与间距同步缩放,自然保持一行;
 * 若所需缩放低于 HL_MIN_SCALE,就退回下限字号并加 `.is-wrap` 让指标换行。
 * 卡片宽度任何变化(换列数 / 窗口缩放 / 应用栏开关)由 ResizeObserver 重算。
 */
function HighlightRow({ items }: { items: NonNullable<Project['highlights']> }) {
  const rowRef = useRef<HTMLDivElement>(null)

  const fit = () => {
    const row = rowRef.current
    if (!row) return
    const kids = Array.from(row.children) as HTMLElement[]
    if (kids.length === 0) return
    row.classList.remove('is-wrap')
    row.style.setProperty('--hl-scale', '1')
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0
    const natural =
      kids.reduce((sum, el) => {
        const v = el.querySelector<HTMLElement>('.zx-highlight-v')?.scrollWidth ?? 0
        const l = el.querySelector<HTMLElement>('.zx-highlight-l')?.scrollWidth ?? 0
        return sum + Math.max(v, l)
      }, 0) +
      gap * (kids.length - 1)
    // 减 1px 留余量,避免亚像素舍入导致溢出
    const avail = row.clientWidth - 1
    if (natural <= 0 || avail <= 0) return
    const scale = avail / natural
    if (scale >= HL_MIN_SCALE) {
      row.style.setProperty('--hl-scale', String(Math.min(1, scale)))
    } else {
      // 缩到下限仍放不下:保持下限字号,改为整块换行
      row.style.setProperty('--hl-scale', String(HL_MIN_SCALE))
      row.classList.add('is-wrap')
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

/** 站长在首页直接拖拽排序时,挂到每张卡上的拖拽描述 */
interface CardDrag {
  dragging: boolean
  dropSide: 'before' | 'after' | null
  register: (el: HTMLElement | null) => void
  handle: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: () => void
    onClickCapture: (e: React.MouseEvent) => void
  }
}

function ProjectCard({
  project,
  idx,
  clicks,
  pv,
  drag,
}: {
  project: Project
  idx: number
  clicks?: number
  pv?: number
  drag?: CardDrag
}) {
  // 本站项目(「本页 · 个人主页」):只显示全站访问量(PV),不计链接点击
  const self = project.demoUrl === '/'
  const demoUrl = normalizeUrl(project.demoUrl)
  const repoUrl = normalizeUrl(project.repoUrl)
  const total = self ? pv ?? 0 : clicks ?? 0
  return (
    <article
      ref={drag?.register}
      className={`zx-card${project.featured ? ' is-featured' : ''}${project.status === 'archived' ? ' is-archived' : ''}${drag ? ' is-admin' : ''}`}
      data-idx={String(idx).padStart(2, '0')}
      data-drop={drag?.dropSide ?? undefined}
      data-dragging={drag?.dragging ? '' : undefined}
    >
      {drag && (
        <span
          className="zx-card-grip"
          {...drag.handle}
          title="按住拖动调整顺序(松开即自动保存)"
          aria-label="拖动调整顺序"
        >
          ⠿
        </span>
      )}
      <div className="zx-card-head" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
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
  isAdmin,
  adminStoredProjects,
  projectsRev,
  clicks,
  pv,
}: {
  projects?: Project[]
  /** 站长:显示 ⠿ 把手,可直接拖拽排序(松开即保存) */
  isAdmin?: boolean
  /** 站长:含垃圾箱的全量项目(SSR 直出);拖拽后据此整表存回 */
  adminStoredProjects?: StoredProject[]
  /** 站长:项目表乐观锁版本戳 */
  projectsRev?: string
  clicks?: Record<string, number>
  pv?: number
}) {
  const [stored, setStored] = useState<StoredProject[] | undefined>(adminStoredProjects)
  const [rev, setRev] = useState<string | undefined>(projectsRev)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(t)
  }, [flash])
  const showFlash = useCallback((kind: 'ok' | 'err', text: string) => setFlash({ kind, text }), [])

  // 分类:显式 kind 优先,缺省按本站(demoUrl='/')推断
  const kindOf = (p: Project): 'personal' | 'work' => p.kind ?? (p.demoUrl === '/' ? 'personal' : 'work')
  // 站长用「含垃圾箱的全量」渲染(排除垃圾箱);否则用传入的可见列表
  const items: Project[] = isAdmin && stored ? stored.filter((p) => !p.deleted) : projects
  const personal = items.filter((p) => kindOf(p) === 'personal')
  const work = items.filter((p) => kindOf(p) === 'work')

  const getProjects = useCallback(async () => {
    try {
      const r = await adminFetch('/api/admin/projects', { cache: 'no-store' })
      if (!r.ok) return null
      const d = (await r.json()) as { projects?: StoredProject[]; rev?: string }
      return { projects: d.projects ?? [], rev: d.rev }
    } catch {
      return null
    }
  }, [])
  const postProjects = useCallback(
    (list: StoredProject[], useRev?: string) =>
      adminFetch('/api/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: list, rev: useRev }),
      }),
    [],
  )

  /**
   * 落手即存:先乐观渲染新顺序,再整表存回。
   * 409(期间别处改过这张表)→ 拉最新列表,**只把新顺序套上去**再重试一次 ——
   * 这样既不会用陈旧内容覆盖别处的改动,也不会因顺序变了而白白报冲突。
   */
  const saveOrder = useCallback(
    async (nextVisibleIds: string[]) => {
      const base = stored
      if (!base) return
      const optimistic = reorderVisible(base, nextVisibleIds)
      setStored(optimistic)
      setSaving(true)
      try {
        let payload = optimistic
        let useRev = rev
        let r = await postProjects(payload, useRev)
        if (r.status === 409) {
          const fresh = await getProjects()
          if (!fresh) throw new Error('读取最新顺序失败')
          payload = reorderVisible(fresh.projects, nextVisibleIds)
          useRev = fresh.rev
          r = await postProjects(payload, useRev)
        }
        const d = (await r.json().catch(() => ({}))) as {
          error?: string
          projects?: StoredProject[]
          rev?: string
        }
        if (!r.ok) throw new Error(d.error || '保存失败')
        setStored(d.projects ?? payload)
        setRev(d.rev)
        showFlash('ok', '顺序已保存')
      } catch (e) {
        setStored(base)
        showFlash('err', e instanceof Error ? e.message : '保存失败')
      } finally {
        setSaving(false)
      }
    },
    [stored, rev, postProjects, getProjects, showFlash],
  )

  const kindById = new Map(items.map((p) => [p.id, kindOf(p)]))
  const drag = useDragReorder({
    ids: items.map((p) => p.id),
    axis: 'grid',
    // 只在同组内拖:个人项目 / 历史工作成果是两个 grid,不能互串
    groupOf: (id) => kindById.get(id) ?? '',
    onCommit: (next) => void saveOrder(next),
    scrollWindow: true,
    getScrollBox: () =>
      typeof document === 'undefined' ? null : (document.scrollingElement as HTMLElement | null),
    disabled: !isAdmin || saving || items.length < 2,
  })
  const dragOf = (id: string): CardDrag | undefined =>
    isAdmin
      ? {
          dragging: drag.dragId === id,
          dropSide:
            drag.dragId !== id && drag.drop?.targetId === id
              ? drag.drop.before
                ? 'before'
                : 'after'
              : null,
          register: drag.registerItem(id),
          handle: drag.handleProps(id),
        }
      : undefined

  return (
    <Section id="projects" tag="// PROJECTS" num="01" title="项目">
      {isAdmin && (
        <div className="zx-projects-admin">
          <span className="zx-projects-admin-hint">拖拽卡片左上角 ⠿ 调整顺序,松开即自动保存</span>
          {saving && <span className="zx-projects-admin-status">保存中…</span>}
          {!saving && flash && (
            <span className="zx-projects-admin-status" data-kind={flash.kind}>
              {flash.text}
            </span>
          )}
        </div>
      )}
      {personal.length > 0 && (
        <div className="zx-grid">
          {personal.map((p, i) => (
            <ProjectCard
              key={p.id}
              project={p}
              idx={i + 1}
              clicks={clicks?.[p.id]}
              pv={pv}
              drag={dragOf(p.id)}
            />
          ))}
        </div>
      )}
      {work.length > 0 && (
        <>
          {personal.length > 0 && <div className="zx-projects-sep" aria-hidden="true" />}
          <div className="zx-grid">
            {work.map((p, i) => (
              <ProjectCard
                key={p.id}
                project={p}
                idx={personal.length + i + 1}
                clicks={clicks?.[p.id]}
                pv={pv}
                drag={dragOf(p.id)}
              />
            ))}
          </div>
        </>
      )}
    </Section>
  )
}
