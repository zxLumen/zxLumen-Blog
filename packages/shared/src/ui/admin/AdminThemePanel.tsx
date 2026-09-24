'use client'

import { Badge, Button, Checkbox, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import type { AppearanceConfig } from '../../theme.js'
import { MantineBridge } from './mantine-bridge.js'
import type { NotifyMsg } from './admin-types.js'

interface ThemeOption {
  id: string
  label: string
  tagline: string
  swatch: [string, string, string]
  mode: string
}

interface LayoutOption {
  id: string
  label: string
  tagline: string
  key: string
}

interface Payload {
  config: AppearanceConfig
  themes: ThemeOption[]
  layouts: LayoutOption[]
  defaults: AppearanceConfig
}

/** 覆盖面门控:外观配置在 Tab 模式下仅对应 Tab 显 */
function gate(showTabs: boolean, tab: string): boolean {
  return showTabs && tab === 'themes'
}

function Swatches({ colors }: { colors: [string, string, string] }) {
  return (
    <Group gap={4}>
      {colors.map((c, i) => (
        <span
          key={i}
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            background: c,
            border: '1px solid var(--line)',
            display: 'inline-block',
          }}
        />
      ))}
    </Group>
  )
}

export function AdminThemePanel({
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
  const [data, setData] = useState<Payload | null>(null)
  const [config, setConfig] = useState<AppearanceConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  const gated = gate(showTabs, tab)

  const notify = (kind: 'ok' | 'err', text: string) => onNotify?.({ kind, text })

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/theme-config', { credentials: 'same-origin', cache: 'no-store' })
      const d = (await r.json()) as Payload
      setData(d)
      setConfig(d.config)
    } catch {
      notify('err', '外观配置加载失败')
    } finally {
      setBusy(false)
    }
  }, [notify])

  useEffect(() => {
    if (gated && active) void load()
  }, [gated, active, loadKey])

  const toggleTheme = (id: string, on: boolean) => {
    setConfig((c) => {
      if (!c) return c
      const themes = on ? [...c.themes, id] : c.themes.filter((t) => t !== id)
      const defaultTheme = themes.includes(c.defaultTheme) ? c.defaultTheme : themes[0]
      return { ...c, themes, defaultTheme }
    })
  }

  const toggleLayout = (id: string, on: boolean) => {
    setConfig((c) => {
      if (!c) return c
      const layouts = (on ? [...c.layouts, id] : c.layouts.filter((l) => l !== id)) as AppearanceConfig['layouts']
      const defaultLayout = layouts.includes(c.defaultLayout) ? c.defaultLayout : layouts[0]
      return { ...c, layouts, defaultLayout }
    })
  }

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      const r = await fetch('/api/admin/theme-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(config),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; config?: AppearanceConfig }
      if (!r.ok) throw new Error(d.error || '保存失败')
      if (d.config) setConfig(d.config)
      notify('ok', '外观配置已保存(访客下次请求生效)')
      setLoadKey((k) => k + 1)
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const dirty =
    !!config && !!data && JSON.stringify(config) !== JSON.stringify(data.config)

  return (
    <MantineBridge>
      <Stack gap="md" mb="lg">
        <Group gap="xs" wrap="wrap" align="center">
          <Title order={3} style={{ margin: 0, fontSize: '1.1rem' }}>
            外观配置
          </Title>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            放行访客可选的主题 / 布局,并设定默认项
          </Text>
          {dirty && (
            <Badge variant="dot" color="yellow" size="sm" ml="auto" style={{ fontFamily: 'var(--font-mono)' }}>
              未保存修改
            </Badge>
          )}
          <Button
            size="xs"
            ml={dirty ? undefined : 'auto'}
            loading={saving}
            disabled={busy || !config}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </Group>

        {busy && <Text c="dimmed" fz="sm">加载中…</Text>}

        {!busy && data && config && (
          <>
            <Paper withBorder radius={8} p="md">
              <Stack gap="xs">
                <Text fw={600} fz="sm">主题({config.themes.length}/{data.themes.length})</Text>
                {data.themes.map((t) => {
                  const on = config.themes.includes(t.id)
                  const isDefault = config.defaultTheme === t.id
                  return (
                    <Group key={t.id} gap="sm" wrap="nowrap" align="center">
                      <Checkbox
                        size="xs"
                        checked={on}
                        onChange={(e) => toggleTheme(t.id, e.currentTarget.checked)}
                        label={
                          <Group gap="xs" align="center" wrap="wrap">
                            <Text component="span" ff="var(--font-mono)" fz="xs">{t.label}</Text>
                            <Swatches colors={t.swatch} />
                            <Text component="span" c="dimmed" fz="xs">{t.tagline}</Text>
                            {isDefault && (
                              <Badge size="xs" variant="light" style={{ fontFamily: 'var(--font-mono)' }}>默认</Badge>
                            )}
                          </Group>
                        }
                      />
                      {on && !isDefault && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          ml="auto"
                          onClick={() => setConfig({ ...config, defaultTheme: t.id })}
                        >
                          设为默认
                        </Button>
                      )}
                    </Group>
                  )
                })}
              </Stack>
            </Paper>

            <Paper withBorder radius={8} p="md">
              <Stack gap="xs">
                <Text fw={600} fz="sm">布局({config.layouts.length}/{data.layouts.length})</Text>
                {data.layouts.map((l) => {
                  const lid = l.id as AppearanceConfig['defaultLayout']
                  const on = config.layouts.includes(lid)
                  const isDefault = config.defaultLayout === l.id
                  return (
                    <Group key={l.id} gap="sm" wrap="nowrap" align="center">
                      <Checkbox
                        size="xs"
                        checked={on}
                        onChange={(e) => toggleLayout(l.id, e.currentTarget.checked)}
                        label={
                          <Group gap="xs" align="center" wrap="wrap">
                            <Text component="span" ff="var(--font-mono)" fz="xs">{l.label}</Text>
                            <Text component="span" c="dimmed" fz="xs">{l.tagline}</Text>
                            {isDefault && (
                              <Badge size="xs" variant="light" style={{ fontFamily: 'var(--font-mono)' }}>默认</Badge>
                            )}
                          </Group>
                        }
                      />
                      {on && !isDefault && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          ml="auto"
                          onClick={() => setConfig({ ...config, defaultLayout: l.id as AppearanceConfig['defaultLayout'] })}
                        >
                          设为默认
                        </Button>
                      )}
                    </Group>
                  )
                })}
              </Stack>
            </Paper>

            <Text c="dimmed" fz="xs" ff="var(--font-mono)">
              提示:默认项必须处于放行集合内;取消勾选会自动把默认项切到集合内其它项。至少保留 1 个主题与 1 个布局。
            </Text>
          </>
        )}
      </Stack>
    </MantineBridge>
  )
}
