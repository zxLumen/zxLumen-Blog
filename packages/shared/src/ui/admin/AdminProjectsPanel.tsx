'use client'

import { Badge, Button, Checkbox, Group, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import type { StoredProject } from '../../schema.js'
import { MantineBridge } from './mantine-bridge.js'
import type { NotifyMsg } from './admin-types.js'

/** 覆盖面门控:项目管理在 Tab 模式下仅对应 Tab 显 */
function gate(showTabs: boolean, tab: string): boolean {
  return showTabs && tab === 'projects'
}

const STATUS_LABEL: Record<string, string> = {
  online: 'ONLINE',
  demo: 'DEMO',
  building: 'BUILDING',
  archived: 'ARCHIVED',
}

const STATUS_OPTIONS = [
  { value: 'online', label: 'ONLINE 在线' },
  { value: 'demo', label: 'DEMO 演示' },
  { value: 'building', label: 'BUILDING 建设中' },
  { value: 'archived', label: 'ARCHIVED 已归档' },
]

const STATUS_COLOR: Record<string, string> = {
  online: '#37b24d',
  demo: '#339af0',
  building: '#f5a623',
  archived: '#868e96',
}

const KIND_OPTIONS = [
  { value: 'personal', label: '个人项目(新)' },
  { value: 'work', label: '历史工作成果' },
]

type Status = StoredProject['status']
type Kind = NonNullable<StoredProject['kind']>

function newId(): string {
  return `proj-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

function statusBadge(value: string) {
  const color = STATUS_COLOR[value] ?? '#868e96'
  return (
    <Badge
      variant="light"
      radius="sm"
      size="sm"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, var(--bg))`,
        border: `1px solid color-mix(in srgb, ${color} 38%, var(--bg))`,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.04em',
      }}
    >
      {STATUS_LABEL[value] ?? value.toUpperCase()}
    </Badge>
  )
}

export function AdminProjectsPanel({
  active,
  showTabs,
  tab,
  onNotify,
}: {
  active: boolean
  showTabs: boolean
  tab: string
  onNotify?: (m: NotifyMsg) => void
}) {
  const [projects, setProjects] = useState<StoredProject[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  const gated = gate(showTabs, tab)
  useEffect(() => {
    if (gated && active) void load()
  }, [gated, active, loadKey])

  const notify = (kind: 'ok' | 'err', text: string) => onNotify?.({ kind, text })

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/projects', { credentials: 'same-origin', cache: 'no-store' })
      const data = (await r.json()) as { projects?: StoredProject[] }
      setProjects(data.projects ?? [])
      setDirty(false)
    } catch {
      notify('err', '项目列表加载失败')
    } finally {
      setBusy(false)
    }
  }, [notify])

  const mutate = (fn: (list: StoredProject[]) => StoredProject[]) => {
    setProjects((list) => fn(list))
    setDirty(true)
  }

  const patch = (id: string, p: Partial<StoredProject>) =>
    mutate((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))

  const move = (id: string, dir: -1 | 1) =>
    mutate((list) => {
      const i = list.findIndex((it) => it.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const add = () =>
    mutate((list) => [
      ...list,
      { id: newId(), name: '新项目', desc: '', tech: [], status: 'online', kind: 'personal', period: '', demoUrl: '', repoUrl: '', featured: false },
    ])

  const trash = (id: string) => mutate((list) => list.map((it) => (it.id === id ? { ...it, deleted: true } : it)))
  const restore = (id: string) => mutate((list) => list.map((it) => (it.id === id ? { ...it, deleted: false } : it)))
  const purge = (id: string) => mutate((list) => list.filter((it) => it.id !== id))

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ projects }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; projects?: StoredProject[] }
      if (!r.ok) throw new Error(d.error || '保存失败')
      if (d.projects) setProjects(d.projects)
      setDirty(false)
      notify('ok', '项目已保存(立即生效)')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const resetToDefaults = async () => {
    if (!confirm('恢复为 content.local.ts 的静态默认项目?当前所有增删改将丢失。')) return
    setSaving(true)
    try {
      const r = await fetch('/api/admin/projects', { method: 'DELETE', credentials: 'same-origin' })
      const d = (await r.json().catch(() => ({}))) as { projects?: StoredProject[] }
      if (!r.ok) throw new Error('恢复失败')
      if (d.projects) setProjects(d.projects)
      setDirty(false)
      notify('ok', '已恢复静态默认项目')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '恢复失败')
    } finally {
      setSaving(false)
    }
  }

  const visible = projects.filter((p) => !p.deleted)
  const trashed = projects.filter((p) => p.deleted)
  const actionsDisabled = busy || saving

  const cardFields = (p: StoredProject) => {
    const techStr = p.tech.join(', ')
    return (
      <Stack gap="sm" key={p.id}>
        <Group gap="xs" wrap="wrap" align="center">
          <Text component="span" ff="var(--font-mono)" lh={1} fz="xs" c="dimmed">
            {p.id}
          </Text>
          {statusBadge(p.status)}
          {p.featured && (
            <Badge variant="dot" size="sm" color="orange" style={{ fontFamily: 'var(--font-mono)' }}>
              ★ featured
            </Badge>
          )}
          <Group gap={4} ml="auto">
            <Button size="compact-xs" variant="subtle" disabled={actionsDisabled} onClick={() => move(p.id, -1)}>
              ↑
            </Button>
            <Button size="compact-xs" variant="subtle" disabled={actionsDisabled} onClick={() => move(p.id, 1)}>
              ↓
            </Button>
            <Button size="compact-xs" variant="subtle" color="red" disabled={actionsDisabled} onClick={() => trash(p.id)}>
              移入垃圾箱
            </Button>
          </Group>
        </Group>

        <TextInput
          label="名称"
          size="xs"
          value={p.name}
          onChange={(e) => patch(p.id, { name: e.target.value })}
        />
        <TextInput
          label="简介"
          size="xs"
          value={p.desc}
          onChange={(e) => patch(p.id, { desc: e.target.value })}
        />

        <Group grow wrap="wrap" align="end" gap="sm">
          <TextInput
            label="周期"
            size="xs"
            value={p.period ?? ''}
            placeholder="如 2022–2024"
            onChange={(e) => patch(p.id, { period: e.target.value })}
          />
          <div>
            <Text component="label" fz="xs" c="dimmed" style={{ display: 'block', marginBottom: 6 }}>
              分类
            </Text>
            <Select
              size="xs"
              data={KIND_OPTIONS}
              value={p.kind ?? (p.demoUrl === '/' ? 'personal' : 'work')}
              allowDeselect={false}
              onChange={(v) => patch(p.id, { kind: (v ?? 'work') as Kind })}
            />
          </div>
          <div>
            <Text component="label" fz="xs" c="dimmed" style={{ display: 'block', marginBottom: 6 }}>
              状态
            </Text>
            <Select
              size="xs"
              data={STATUS_OPTIONS}
              value={p.status}
              allowDeselect={false}
              onChange={(v) => patch(p.id, { status: (v ?? p.status) as Status })}
            />
          </div>
        </Group>

        <Group grow wrap="wrap" gap="sm">
          <TextInput
            label="demoUrl"
            size="xs"
            value={p.demoUrl ?? ''}
            placeholder="/ 表示本站"
            onChange={(e) => patch(p.id, { demoUrl: e.target.value })}
          />
          <TextInput
            label="repoUrl"
            size="xs"
            value={p.repoUrl ?? ''}
            placeholder="GitHub 链接"
            onChange={(e) => patch(p.id, { repoUrl: e.target.value })}
          />
        </Group>

        <TextInput
          label="tech"
          size="xs"
          value={techStr}
          placeholder="逗号分隔,如 React, TypeScript"
          onChange={(e) =>
            patch(p.id, { tech: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
          }
        />

        <Group justify="space-between" align="center" gap="sm" wrap="wrap">
          <Checkbox
            label="featured"
            size="xs"
            checked={!!p.featured}
            onChange={(e) => patch(p.id, { featured: e.currentTarget.checked })}
          />
        </Group>
      </Stack>
    )
  }

  return (
    <MantineBridge>
      <Stack gap="md" mb="lg">
        <Group gap="xs" wrap="wrap" align="center">
          <Title order={3} style={{ margin: 0, fontSize: '1.1rem' }}>
            项目管理
          </Title>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            可新增 / 删除 / 排序,保存后立即生效
          </Text>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            {visible.length} 个项目{trashed.length > 0 ? ` · 垃圾箱 ${trashed.length}` : ''}
          </Text>
          {dirty && (
            <Badge variant="dot" color="yellow" size="sm" style={{ fontFamily: 'var(--font-mono)' }}>
              未保存修改
            </Badge>
          )}
          <Group gap="xs" ml="auto">
            <Button size="compact-xs" variant="light" disabled={actionsDisabled} onClick={add}>
              + 新增项目
            </Button>
            <Button size="compact-xs" variant="default" disabled={actionsDisabled} onClick={() => void resetToDefaults()}>
              恢复静态默认
            </Button>
            <Button size="xs" loading={saving} disabled={busy || !dirty} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </Group>
        </Group>

        {busy && <Text c="dimmed" fz="sm">加载中…</Text>}
        {!busy && visible.length === 0 && <Text c="dimmed" fz="sm">暂无项目,点「+ 新增项目」添加。</Text>}

        {!busy &&
          visible.map((p) => (
            <Paper key={p.id} withBorder radius={8} p="md">
              {cardFields(p)}
            </Paper>
          ))}

        {trashed.length > 0 && (
          <Stack gap="xs">
            <Group gap="xs" align="center">
              <Button size="compact-xs" variant="subtle" onClick={() => setShowTrash((s) => !s)}>
                {showTrash ? '▾' : '▸'} 垃圾箱({trashed.length})
              </Button>
            </Group>
            {showTrash &&
              trashed.map((p) => (
                <Paper key={p.id} withBorder radius={8} p="sm" style={{ opacity: 0.75 }}>
                  <Group gap="xs" wrap="wrap" align="center">
                    <Text component="span" ff="var(--font-mono)" fz="xs" c="dimmed">
                      {p.id}
                    </Text>
                    <Text component="span" fz="xs" c="dimmed">
                      {p.name}
                    </Text>
                    {statusBadge(p.status)}
                    <Group gap="xs" ml="auto">
                      <Button size="compact-xs" variant="light" disabled={actionsDisabled} onClick={() => restore(p.id)}>
                        恢复
                      </Button>
                      <Button size="compact-xs" variant="light" color="red" disabled={actionsDisabled} onClick={() => purge(p.id)}>
                        彻底删除
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              ))}
          </Stack>
        )}
      </Stack>
    </MantineBridge>
  )
}
