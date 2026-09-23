'use client'

import { Badge, Button, Checkbox, Group, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyProjectOverrides,
  PROJECTS,
  type Project,
  type ProjectOverrideInput,
  type ProjectOverrideRecord,
} from '@zx/shared'
import { MantineBridge } from './mantine-bridge.js'

interface NotifyMsg {
  kind: 'ok' | 'err'
  text: string
}

/**
 * 覆盖面门控:项目管理属非核心管理位,在 Tab 模式降低到「仅 Tab 显」。
 */
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

const STATUS_KEY: Record<string, number> = {
  online: 0,
  demo: 1,
  building: 2,
  archived: 3,
}

const REVERSED_STATUS: Record<number, string> = {
  0: 'online',
  1: 'demo',
  2: 'building',
  3: 'archived',
}

const FEATURED_NUM: Record<string, number> = {
  'false': 0,
  'true': 1,
}

/** 从 Project 或 override 记录构造"覆盖所需的扁平字符串形状" */
function toOverrideRecord(p: Project): ProjectOverrideRecord {
  return {
    id: p.id,
    name: p.name,
    desc: p.desc,
    period: p.period ?? '',
    status: p.status,
    featured: (p.featured ?? false) ? 1 : 0,
    demoUrl: p.demoUrl ?? '',
    repoUrl: p.repoUrl ?? '',
    tech: (p.tech ?? []).join(', '),
    updatedAt: '',
  }
}

/** tech 字符串 → 数组(去空白去空项) */
function techToArray(s: string): string[] {
  return s.split(',').map((t) => t.trim()).filter(Boolean)
}

/** 判断某字段当前表单值是否"未覆盖"(与默认相同)——用于高亮差异 */
function fieldDiffers(defaults: Project, row: FormRow): boolean {
  return (
    row.name !== defaults.name
    || row.desc !== defaults.desc
    || row.period !== (defaults.period ?? '')
    || row.status !== defaults.status
    || row.featured !== (defaults.featured ?? false)
    || row.demoUrl !== (defaults.demoUrl ?? '')
    || row.repoUrl !== (defaults.repoUrl ?? '')
    || techToArray(row.tech).join(', ') !== (defaults.tech ?? []).join(', ')
  )
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
  const [res, setRes] = useState<{ projects?: Project[]; overrides?: ProjectOverrideRecord[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Record<string, FormRow>>({})
  const [saving, setSaving] = useState<string | null>(null)
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
  }, [notify])

  const refresh = useCallback(() => setLoadKey((k) => k + 1), [])

  const setField = (id: string, patch: Partial<FormRow>) =>
    setForm((f) => ({ ...f, [id]: { ...(f[id] ?? {}), ...patch } } as Record<string, FormRow>))

  const save = async (id: string) => {
    const row = form[id]
    if (!row) return
    setSaving(id)
    try {
      const r = await fetch('/api/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id,
          input: {
            name: row.name,
            desc: row.desc,
            period: row.period,
            status: row.status,
            featured: row.featured ? 1 : 0,
            demoUrl: row.demoUrl,
            repoUrl: row.repoUrl,
            tech: row.tech,
          },
        }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(d.error || '保存失败')
      notify('ok', `已保存「${id}」的项目配置(立即生效)`)
      refresh()
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(null)
    }
  }

  const clear = async (id: string) => {
    setSaving(id)
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
      setSaving(null)
    }
  }

  const clearAll = async () => {
    if (!(res?.projects ?? []).length) {
      notify('ok', '暂无项目')
      return
    }
    setSaving('*')
    try {
      for (const p of res!.projects ?? []) {
        const r = await fetch('/api/admin/projects', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ id: p.id }),
        })
        if (!r.ok) throw new Error(`恢复「${p.id}」失败`)
      }
      notify('ok', '已恢复全部项目默认配置')
      refresh()
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '清除失败')
    } finally {
      setSaving(null)
    }
  }

  const overlayCount = (res?.projects ?? []).filter((p) => {
    const ov = (res?.overrides ?? []).find((o) => o.id === p.id)
    // 有覆盖记录即视为已覆盖(可能只覆盖了部分字段)
    return !!ov
  }).length

  const overriddenIds = useMemo(
    () => new Set((res?.overrides ?? []).map((o) => o.id)),
    [res],
  )

  const previewProjects = useMemo(() => {
    const input: Record<string, ProjectOverrideInput> = {}
    for (const p of res?.projects ?? []) {
      const row = form[p.id]
      if (row) {
        input[p.id] = {
          name: row.name, desc: row.desc, period: row.period, status: row.status,
          featured: row.featured ? 1 : 0, demoUrl: row.demoUrl, repoUrl: row.repoUrl,
          tech: techToArray(row.tech).join(', '),
        }
      }
    }
    return applyProjectOverrides(PROJECTS, (res?.projects ?? []).map(toOverrideRecord).filter((p) => input[p.id]).map((p) => ({ ...p, ...input[p.id] })))
  }, [res, form])

  const actionsDisabled = busy || saving !== null

  return (
    <MantineBridge>
      <Stack gap="md" mb="lg">
        <Group gap="xs" wrap="wrap" align="center">
          <Title order={3} style={{ margin: 0, fontSize: '1.1rem' }}>
            项目管理
          </Title>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            覆盖保存在服务器,SSR 立即生效
          </Text>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            {overlayCount}/{res?.projects?.length ?? 0} 已覆盖
          </Text>
          {overlayCount > 0 && (
            <Button
              size="compact-xs"
              variant="light"
              color="red"
              ml="auto"
              disabled={actionsDisabled}
              onClick={() => void clearAll()}
            >
              恢复全部默认
            </Button>
          )}
        </Group>

        {busy && <Text c="dimmed" fz="sm">加载中…</Text>}
        {!busy && (res?.projects?.length ?? 0) === 0 && <Text c="dimmed" fz="sm">暂无项目</Text>}

        {!busy &&
          (res?.projects ?? []).map((p) => {
            const row = form[p.id] ?? {
              name: p.name,
              desc: p.desc,
              period: p.period ?? '',
              status: p.status,
              featured: p.featured ?? false,
              demoUrl: p.demoUrl ?? '',
              repoUrl: p.repoUrl ?? '',
              tech: (p.tech ?? []).join(', '),
            }
            const hasOverride = overriddenIds.has(p.id)
            const differs = fieldDiffers(p, row)
            const techTags = techToArray(row.tech)
            return (
              <Paper key={p.id} withBorder radius={8} p="md" w="100%">
                <Stack gap="sm">
                  <Group gap="xs" wrap="wrap" align="center">
                    <Text component="strong" ff="var(--font-mono)" lh={1} c="var(--fg)">
                      {p.id}
                    </Text>
                    {statusBadge(row.status)}
                    {hasOverride && (
                      <Badge variant="dot" size="sm" color="yellow" style={{ fontFamily: 'var(--font-mono)' }}>
                        已覆盖
                      </Badge>
                    )}
                    {row.featured && (
                      <Badge variant="dot" size="sm" color="orange" style={{ fontFamily: 'var(--font-mono)' }}>
                        ★ featured
                      </Badge>
                    )}
                    {differs && !hasOverride && (
                      <Badge variant="dot" size="sm" color="red" style={{ fontFamily: 'var(--font-mono)' }}>
                        未保存修改
                      </Badge>
                    )}
                  </Group>

                  <TextInput
                    label="名称"
                    size="xs"
                    value={row.name}
                    placeholder="项目名称"
                    onChange={(e) => setField(p.id, { name: e.target.value })}
                  />
                  <TextInput
                    label="简介"
                    size="xs"
                    value={row.desc}
                    placeholder="一句话简介"
                    onChange={(e) => setField(p.id, { desc: e.target.value })}
                  />

                  <Group grow wrap="wrap" align="end" gap="sm">
                    <TextInput
                      label="周期"
                      size="xs"
                      value={row.period}
                      placeholder="如 2022–2024"
                      onChange={(e) => setField(p.id, { period: e.target.value })}
                    />
                    <div>
                      <Text component="label" fz="xs" c="dimmed" style={{ display: 'block', marginBottom: 6 }}>
                        状态
                      </Text>
                      <Select
                        size="xs"
                        data={STATUS_OPTIONS}
                        value={row.status}
                        onChange={(v) => setField(p.id, { status: v ?? row.status })}
                        allowDeselect={false}
                      />
                    </div>
                  </Group>

                  <Group grow wrap="wrap" gap="sm">
                    <TextInput
                      label="demoUrl"
                      size="xs"
                      value={row.demoUrl}
                      placeholder="/ 表示本站"
                      onChange={(e) => setField(p.id, { demoUrl: e.target.value })}
                    />
                    <TextInput
                      label="repoUrl"
                      size="xs"
                      value={row.repoUrl}
                      placeholder="GitHub 链接"
                      onChange={(e) => setField(p.id, { repoUrl: e.target.value })}
                    />
                  </Group>

                  <TextInput
                    label="tech"
                    size="xs"
                    value={row.tech}
                    placeholder="逗号分隔,如 React, TypeScript"
                    onChange={(e) => setField(p.id, { tech: e.target.value })}
                  />

                  {techTags.length > 0 && (
                    <Group gap={6}>
                      {techTags.map((t) => (
                        <Badge key={t} variant="light" radius="sm" size="sm" style={{ fontFamily: 'var(--font-mono)' }}>
                          #{t}
                        </Badge>
                      ))}
                    </Group>
                  )}

                  <Paper
                    withBorder
                    radius={8}
                    p="sm"
                    style={{
                      background: 'color-mix(in srgb, var(--elev) 45%, var(--bg))',
                      borderStyle: 'dashed',
                    }}
                  >
                    <Stack gap={4}>
                      <Text fz="xs" c="dimmed" ff="var(--font-mono)">
                        ⚡ 实时预览
                      </Text>
                      <Group gap={8} wrap="wrap" align="center">
                        <Text component="strong" ff="var(--font-mono)" lh={1.2}>
                          {row.name || '«未命名»'}
                        </Text>
                        {row.period && (
                          <Text component="span" fz="xs" c="dimmed">
                            ({row.period})
                          </Text>
                        )}
                        {statusBadge(row.status)}
                        {row.featured && (
                          <Text component="span" fz="xs" c="var(--accent-2)">
                            ★ featured
                          </Text>
                        )}
                      </Group>
                      {row.desc && (
                        <Text component="p" fz={12} c="var(--fg-dim)" style={{ margin: 0, lineHeight: 1.5 }}>
                          {row.desc}
                        </Text>
                      )}
                      {techTags.length > 0 && (
                        <Group gap={6}>
                          {techTags.map((t) => (
                            <Badge key={t} variant="light" radius="sm" size="xs" style={{ fontFamily: 'var(--font-mono)' }}>
                              #{t}
                            </Badge>
                          ))}
                        </Group>
                      )}
                    </Stack>
                  </Paper>

                  <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                    <Checkbox
                      label="featured"
                      size="xs"
                      checked={row.featured}
                      onChange={(e) => setField(p.id, { featured: e.currentTarget.checked })}
                    />
                    <Group gap="xs">
                      <Button
                        size="xs"
                        loading={saving === p.id}
                        disabled={actionsDisabled}
                        onClick={() => void save(p.id)}
                      >
                        {saving === p.id ? '保存中…' : '保存'}
                      </Button>
                      {hasOverride && (
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          disabled={actionsDisabled}
                          onClick={() => void clear(p.id)}
                        >
                          恢复默认
                        </Button>
                      )}
                    </Group>
                  </Group>
                </Stack>
              </Paper>
            )
          })}
      </Stack>
    </MantineBridge>
  )
}