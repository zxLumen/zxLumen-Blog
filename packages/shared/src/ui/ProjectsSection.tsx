'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PROJECTS, normalizeUrl, isExternalUrl, type Project } from '../content.js'
import type { StoredProject } from '../schema.js'
import { Section, useSectionHeader } from './Section.js'
import { trackEvent } from './track.js'
import { useDragReorder } from './useDragReorder.js'
import { reorderVisible, mergeProjectsForSave } from './projects-order.js'
import { adminFetch } from './admin/admin-fetch.js'
import { useEditable, EditControls, InlineText } from './inline-edit.js'
import type { SectionHeader } from './site-edit-types.js'

/** 亮点字号的最小缩放比;缩到该值仍放不下时改为换行(不用省略号) */
const HL_MIN_SCALE = 0.7
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * 亮点(指标)行:优先保持**一行**、按卡片可用宽度自动缩放字号;缩到下限仍放不下
 * 就整块**换行**(不使用省略号)。
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
    const avail = row.clientWidth - 1
    if (natural <= 0 || avail <= 0) return
    const scale = avail / natural
    if (scale >= HL_MIN_SCALE) {
      row.style.setProperty('--hl-scale', String(Math.min(1, scale)))
    } else {
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
  isAdmin,
  onSave,
}: {
  project: StoredProject
  idx: number
  clicks?: number
  pv?: number
  drag?: CardDrag
  isAdmin?: boolean
  onSave: (next: StoredProject) => Promise<void>
}) {
  const ed = useEditable<StoredProject>(project, onSave)
  const editing = !!isAdmin && ed.editing
  const p = isAdmin ? ed.value : project
  const patch = (fields: Partial<Project>) => ed.setValue((s) => ({ ...s, ...fields }))

  // 本站项目(「本页 · 个人主页」):只显示全站访问量(PV),不计链接点击
  const self = p.demoUrl === '/'
  const demoUrl = normalizeUrl(p.demoUrl)
  const repoUrl = normalizeUrl(p.repoUrl)
  const total = self ? pv ?? 0 : clicks ?? 0

  return (
    <article
      ref={drag?.register}
      className={`zx-card${p.featured ? ' is-featured' : ''}${p.status === 'archived' ? ' is-archived' : ''}${drag ? ' is-admin' : ''}${editing ? ' is-editing' : ''}`}
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
      {isAdmin && (
        <span className="zx-card-edit">
          <EditControls
            editing={ed.editing}
            dirty={ed.dirty}
            saving={ed.saving}
            error={ed.error}
            onStart={ed.start}
            onCancel={ed.cancel}
            onSave={ed.commit}
            label="编辑项目"
          />
        </span>
      )}

      <div className="zx-card-head" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        {editing ? (
          <InlineText
            className="zx-inline-card-title"
            value={p.name}
            onChange={(v) => patch({ name: v })}
            placeholder="项目名"
            ariaLabel="项目名"
          />
        ) : (
          <h3 style={{ margin: 0 }}>{p.name}</h3>
        )}
        {!editing && total > 0 && (
          <span className="zx-project-clicks" title={self ? '全站访问量' : '链接点击次数'}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 4l7 16 2.5-6.5L20 11 4 4z" />
            </svg>
            {total} 次点击
          </span>
        )}
      </div>

      <div className="zx-card-meta">
        {editing ? (
          <select
            className="zx-edit-select"
            value={p.status}
            onChange={(e) => patch({ status: e.target.value as Project['status'] })}
            aria-label="状态"
          >
            <option value="online">ONLINE</option>
            <option value="demo">DEMO</option>
            <option value="building">BUILDING</option>
            <option value="archived">ARCHIVED</option>
          </select>
        ) : (
          <span className="zx-status" data-status={p.status}>
            {STATUS_LABEL[p.status]}
          </span>
        )}
        {editing ? (
          <InlineText
            className="zx-inline-w-xs"
            value={p.period ?? ''}
            onChange={(v) => patch({ period: v })}
            placeholder="周期"
            ariaLabel="周期"
          />
        ) : (
          p.period && (
            <span className="zx-mono zx-muted" style={{ fontSize: '0.68rem' }}>
              {p.period}
            </span>
          )
        )}
      </div>

      {editing ? (
        <InlineText multiline value={p.desc} onChange={(v) => patch({ desc: v })} placeholder="简介" ariaLabel="简介" />
      ) : (
        <p style={{ marginTop: '0.7rem' }}>{p.desc}</p>
      )}

      <div className="zx-card-bottom">
        {editing ? (
          <div className="zx-highlights-edit">
            {(p.highlights ?? []).map((h, hi) => (
              <span className="zx-inline-row" key={hi}>
                <InlineText
                  className="zx-inline-w-xs"
                  value={h.value}
                  onChange={(value) =>
                    patch({
                      highlights: (p.highlights ?? []).map((x, j) => (j === hi ? { ...x, value } : x)),
                    })
                  }
                  placeholder="数值"
                  ariaLabel="亮点数值"
                />
                <InlineText
                  value={h.label}
                  onChange={(label) =>
                    patch({
                      highlights: (p.highlights ?? []).map((x, j) => (j === hi ? { ...x, label } : x)),
                    })
                  }
                  placeholder="标签"
                  ariaLabel="亮点标签"
                />
                <button
                  type="button"
                  className="zx-edit-x"
                  title="删除亮点"
                  aria-label="删除亮点"
                  onClick={() => patch({ highlights: (p.highlights ?? []).filter((_, j) => j !== hi) })}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="zx-edit-add"
              onClick={() => patch({ highlights: [...(p.highlights ?? []), { label: '', value: '' }] })}
            >
              + 亮点
            </button>
          </div>
        ) : (
          p.highlights && p.highlights.length > 0 && <HighlightRow items={p.highlights} />
        )}

        <div className="zx-tags">
          {editing ? (
            <InlineText
              value={p.tech.join(', ')}
              onChange={(v) => patch({ tech: v.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="技术(逗号分隔)"
              ariaLabel="技术栈"
            />
          ) : (
            p.tech.map((t) => (
              <span className="zx-badge" key={t}>
                {t}
              </span>
            ))
          )}
        </div>

        {editing ? (
          <div className="zx-card-edit-fields">
            <InlineText value={p.demoUrl ?? ''} onChange={(v) => patch({ demoUrl: v })} placeholder="Demo URL" ariaLabel="Demo URL" />
            <InlineText value={p.repoUrl ?? ''} onChange={(v) => patch({ repoUrl: v })} placeholder="Repo URL" ariaLabel="Repo URL" />
            <label className="zx-edit-check">
              <input type="checkbox" checked={!!p.featured} onChange={(e) => patch({ featured: e.target.checked })} />
              精选
            </label>
          </div>
        ) : (
          <div className="zx-card-actions">
            {demoUrl && (
              <a
                className="zx-btn zx-btn-sm"
                href={demoUrl}
                target={isExternalUrl(demoUrl) ? '_blank' : undefined}
                rel="noreferrer"
                onClick={() => trackEvent('project_click', p.id)}
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
                onClick={() => trackEvent('project_click', p.id)}
              >
                repo
              </a>
            )}
          </div>
        )}
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
  sectionHeader,
}: {
  projects?: Project[]
  isAdmin?: boolean
  adminStoredProjects?: StoredProject[]
  projectsRev?: string
  clicks?: Record<string, number>
  pv?: number
  sectionHeader?: SectionHeader
}) {
  const [stored, setStored] = useState<StoredProject[] | undefined>(adminStoredProjects)
  const [rev, setRev] = useState<string | undefined>(projectsRev)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const header = useSectionHeader('projects', { tag: '// PROJECTS', title: '项目' }, sectionHeader)

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(t)
  }, [flash])
  const showFlash = useCallback((kind: 'ok' | 'err', text: string) => setFlash({ kind, text }), [])

  const kindOf = (p: Project): 'personal' | 'work' => p.kind ?? (p.demoUrl === '/' ? 'personal' : 'work')
  const items: StoredProject[] = isAdmin && stored ? stored.filter((p) => !p.deleted) : projects
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

  /** 把一份完整列表存回(409 时按 id 合并最新内容再重试一次) */
  const postTable = useCallback(
    async (edited: StoredProject[]) => {
      let payload = edited
      let useRev = rev
      let r = await postProjects(payload, useRev)
      if (r.status === 409) {
        const fresh = await getProjects()
        if (!fresh) throw new Error('读取最新项目失败')
        payload = mergeProjectsForSave(fresh.projects, adminStoredProjects ?? edited, edited)
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
    },
    [rev, postProjects, getProjects, adminStoredProjects],
  )

  const saveOrder = useCallback(
    async (nextVisibleIds: string[]) => {
      const base = stored
      if (!base) return
      const optimistic = reorderVisible(base, nextVisibleIds)
      setStored(optimistic)
      setSaving(true)
      try {
        await postTable(optimistic)
        showFlash('ok', '顺序已保存')
      } catch (e) {
        setStored(base)
        showFlash('err', e instanceof Error ? e.message : '保存失败')
      } finally {
        setSaving(false)
      }
    },
    [stored, postTable, showFlash],
  )

  /** 单张卡片的保存:更新本地并整表存回 */
  const saveProject = useCallback(
    async (next: StoredProject) => {
      const base = stored
      if (!base) throw new Error('尚未载入项目')
      const edited = base.map((p) => (p.id === next.id ? { ...next, id: p.id } : p))
      setStored(edited)
      setSaving(true)
      try {
        await postTable(edited)
        showFlash('ok', '项目已保存')
      } catch (e) {
        setStored(base)
        showFlash('err', e instanceof Error ? e.message : '保存失败')
        throw e
      } finally {
        setSaving(false)
      }
    },
    [stored, postTable, showFlash],
  )

  const kindById = new Map(items.map((p) => [p.id, kindOf(p)]))
  const drag = useDragReorder({
    ids: items.map((p) => p.id),
    axis: 'grid',
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
    <Section
      id="projects"
      tag={sectionHeader?.tag ?? '// PROJECTS'}
      num="01"
      title={sectionHeader?.title ?? '项目'}
      edit={isAdmin ? header : undefined}
    >
      {isAdmin && (
        <div className="zx-projects-admin">
          <span className="zx-projects-admin-hint">拖拽卡片左上角 ⠿ 调整顺序(松开即保存);点卡片右上角 ✎ 编辑内容</span>
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
              isAdmin={isAdmin}
              onSave={saveProject}
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
                isAdmin={isAdmin}
                onSave={saveProject}
              />
            ))}
          </div>
        </>
      )}
    </Section>
  )
}
