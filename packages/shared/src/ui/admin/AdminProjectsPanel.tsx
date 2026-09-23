import { useCallback, useEffect, useState } from 'react'
import {
  applyProjectOverrides,
  PROJECTS,
  type Project,
  type ProjectOverrideInput,
  type ProjectOverrideRecord,
} from '@zx/shared'

interface Notify {
  kind: 'ok' | 'err'
  text: string
}

/** 覆盖面门控:项目覆盖属非核心管理位,在 Tab 模式降低到「仅 Tab 显」 */
function gate(showTabs: boolean, tab: string): boolean {
  return showTabs && tab === 'projects'
}

interface FormRow {
  name: string
  desc: string
  period: string
  status: string
  featured: boolean
  demoUrl: string
  repoUrl: string
  tech: string
}

export function AdminProjectsPanel({
  active,
  onNotify,
}: {
  active: boolean
  onNotify?: (m: Notify) => void
}) {
  const [res, setRes] = useState<{ projects?: Project[]; overrides?: ProjectOverrideRecord[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Record<string, FormRow>>({})
  const [loadKey, setLoadKey] = useState(0)

  const notify = (kind: 'ok' | 'err', text: string) => onNotify?.({ kind, text })

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/projects', { credentials: 'same-origin', cache: 'no-store' })
      const data = (await r.json()) as { projects?: Project[]; overrides?: ProjectOverrideRecord[] }
      setRes(data)
      const f: Record<string, FormRow> = {}
      for (const p of data.projects ?? []) {
        f[p.id] = {
          name: p.name,
          desc: p.desc,
          period: p.period ?? '',
          status: p.status,
          featured: p.featured ?? false,
          demoUrl: p.demoUrl ?? '',
          repoUrl: p.repoUrl ?? '',
          tech: (p.tech ?? []).join(', '),
        }
      }
      setForm(f)
    } catch {
      notify('err', '项目列表加载失败')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (active) void load()
  }, [active, load, loadKey])

  const refresh = () => setLoadKey((k) => k + 1)

  const save = async (id: string, input: ProjectOverrideInput) => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id, input }),
      })
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(d.error || '保存失败')
      }
      notify('ok', `已保存「${id}」的项目配置(立即生效)`)
      refresh()
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const clear = async (id: string) => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      })
      if (!r.ok) throw new Error('清除失败')
      notify('ok', `已恢复「${id}」默认配置`)
      refresh()
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  if (!active) return null
  return (
    <div className="zx-panel" style={{ marginBottom: '1.2rem' }}>
      <h3>
        项目管理 <span className="zx-muted zx-mono" style={{ fontSize: '0.75rem' }}>覆盖保存在服务器,SSR 立即生效</span>
      </h3>
      {busy && <p className="zx-muted">加载中…</p>}
      {!busy && res?.projects?.length === 0 && <p className="zx-muted">暂无项目</p>}
      {!busy &&
        (res?.projects ?? []).map((p) => {
          const row = form[p.id] ?? {
            name: p.name,
            desc: p.desc,
            period: p.period,
            status: p.status,
            featured: p.featured,
            demoUrl: p.demoUrl,
            repoUrl: p.repoUrl,
            tech: (p.tech ?? []).join(', '),
          }
          const ov = (res?.overrides ?? []).find((o) => o.id === p.id)
          return (
            <div key={p.id} className="zx-row" style={{ marginBottom: '0.9rem', borderBottom: '1px dashed var(--zx-border, #eee)' }}>
              <div className="zx-row-head" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <strong>{p.id}</strong>
                {ov && <span className="zx-ok-tag" style={{ fontSize: '0.7rem' }}>已覆盖</span>}
                <button className="zx-btn zx-btn-sm" type="button" onClick={() => void clear(p.id)} disabled={busy}>
                  恢复默认
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginTop: '0.5rem' }}>
                <input className="zx-input" value={row.name ?? ''} placeholder="名称"
                  onChange={(e) => setForm((f) => ({ ...f, [p.id]: { ...f[p.id], name: e.target.value } }))} />
                <input className="zx-input" value={row.period ?? ''} placeholder="周期(如 2022–2024)"
                  onChange={(e) => setForm((f) => ({ ...f, [p.id]: { ...f[p.id], period: e.target.value } }))} />
                <input className="zx-input" value={row.demoUrl ?? ''} placeholder="demoUrl(如 / 表示本站)"
                  onChange={(e) => setForm((f) => ({ ...f, [p.id]: { ...f[p.id], demoUrl: e.target.value } }))} />
                <input className="zx-input" value={row.repoUrl ?? ''} placeholder="repoUrl(GitHub 链接)"
                  onChange={(e) => setForm((f) => ({ ...f, [p.id]: { ...f[p.id], repoUrl: e.target.value } }))} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={row.featured ?? false} onChange={(e) => setForm((f) => ({ ...f, [p.id]: { ...f[p.id], featured: e.target.checked } }))} />
                  featured
                </label>
                <button className="zx-btn zx-btn-sm zx-btn-primary" type="button" disabled={busy}
                  onClick={() => void save(p.id, {
                    name: row.name, desc: row.desc, period: row.period, status: row.status,
                    featured: row.featured ? 1 : 0, demoUrl: row.demoUrl, repoUrl: row.repoUrl,
                    tech: row.tech,
                  })}>
                  保存
                </button>
              </div>
            </div>
          )
        })}
    </div>
  )
}
