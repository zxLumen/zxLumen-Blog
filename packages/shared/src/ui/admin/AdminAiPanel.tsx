'use client'

import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { MantineBridge } from './mantine-bridge.js'
import { adminFetch } from './admin-fetch.js'
import type { NotifyMsg } from './admin-types.js'

interface ProviderVM {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  keyMask?: string
  hasKey?: boolean
  model: string
  models: string[]
  enabled: boolean
  role: 'chat' | 'embed' | 'both' | 'audio'
  api?: 'openai' | 'deepgram' | 'assemblyai'
}

interface AppVM {
  id: string
  name: string
  token: string
  enabled: boolean
  providerId: string
  model: string
  dailyLimit: number
  totalLimit: number
  audioLimit: number
  note: string
  usage?: { today: number; total: number; audioToday: number; audioTotal: number }
}

interface ConfigVM {
  version: number
  chatProviderId: string
  embedProviderId: string
  audioProviderId: string
  providers: ProviderVM[]
  apps: AppVM[]
}

interface Payload {
  config: ConfigVM
}

interface TestVM {
  loading?: boolean
  ok?: boolean
  ms?: number
  status?: number
  endpoint?: string
  error?: string
}

function gate(showTabs: boolean, tab: string): boolean {
  return showTabs && tab === 'ai'
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `zxai_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

/** 去重(某些上游会返回重复的模型名 → Mantine Select 不允许重复 value) */
function uniqModels(arr?: string[]): string[] {
  return arr ? Array.from(new Set(arr)) : []
}

const ROLE_OPTIONS = [
  { value: 'chat', label: '对话' },
  { value: 'embed', label: '向量' },
  { value: 'both', label: '通用' },
  { value: 'audio', label: '音频' },
]

/** 音频 provider 的上游接口形状 */
const API_OPTIONS = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'deepgram', label: 'Deepgram(分离)' },
  { value: 'assemblyai', label: 'AssemblyAI(分离)' },
]

/** 常见供应商的 OpenAI 兼容端点:选中即自动填 baseUrl */
const PROVIDER_PRESETS = [
  { value: 'https://opencode.ai/zen/go/v1', label: 'OpenCode Go' },
  { value: 'https://opencode.ai/zen/v1', label: 'OpenCode Zen' },
  { value: 'https://api.deepseek.com/v1', label: 'DeepSeek' },
  { value: 'https://open.bigmodel.cn/api/paas/v4', label: '智谱 GLM' },
  { value: 'https://api.openai.com/v1', label: 'OpenAI' },
  { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: '通义千问(百炼)' },
  { value: 'https://api.moonshot.cn/v1', label: 'Moonshot / Kimi' },
  { value: 'https://api.siliconflow.cn/v1', label: '硅基流动' },
  { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter' },
  { value: 'https://api.deepgram.com', label: 'Deepgram' },
  { value: 'https://api.assemblyai.com', label: 'AssemblyAI' },
  { value: 'http://localhost:11434/v1', label: 'Ollama(OpenAI 兼容)' },
]

function copyText(text: string, onOk: () => void, onErr: () => void) {
  if (!text) return
  if (navigator.clipboard) {
    void navigator.clipboard.writeText(text).then(onOk).catch(onErr)
  } else {
    onErr()
  }
}

export function AdminAiPanel({
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
  const [data, setData] = useState<ConfigVM | null>(null)
  const [config, setConfig] = useState<ConfigVM | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadKey, setLoadKey] = useState(0)
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [modelsBusy, setModelsBusy] = useState('')
  const [tests, setTests] = useState<Record<string, TestVM>>({})
  const [testingAll, setTestingAll] = useState(false)

  const gated = gate(showTabs, tab)
  const notify = (kind: 'ok' | 'err', text: string) => onNotify?.({ kind, text })

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await adminFetch('/api/admin/ai-gateway', { cache: 'no-store' })
      const d = (await r.json()) as Payload
      setData(d.config)
      setConfig(JSON.parse(JSON.stringify(d.config)) as ConfigVM)
    } catch {
      notify('err', 'AI 密钥加载失败')
    } finally {
      setBusy(false)
    }
  }, [notify])

  useEffect(() => {
    if (gated && active) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gated, active, loadKey])

  const updProvider = (i: number, patch: Partial<ProviderVM>) =>
    setConfig((c) => (c ? { ...c, providers: c.providers.map((p, j) => (j === i ? { ...p, ...patch } : p)) } : c))

  const updApp = (i: number, patch: Partial<AppVM>) =>
    setConfig((c) => (c ? { ...c, apps: c.apps.map((a, j) => (j === i ? { ...a, ...patch } : a)) } : c))

  const addProvider = () =>
    setConfig((c) =>
      c
        ? {
            ...c,
            providers: [
              ...c.providers,
              { id: newId('provider'), name: '新密钥', baseUrl: '', apiKey: '', model: '', models: [], enabled: true, role: 'chat', api: 'openai' },
            ],
          }
        : c,
    )

  const addApp = () =>
    setConfig((c) =>
      c
        ? {
            ...c,
            apps: [
              ...c.apps,
              {
                id: newId('app'),
                name: '新应用',
                token: randomToken(),
                enabled: true,
                providerId: '',
                model: '',
                dailyLimit: 0,
                totalLimit: 0,
                audioLimit: 0,
                note: '',
                usage: { today: 0, total: 0, audioToday: 0, audioTotal: 0 },
              },
            ],
          }
        : c,
    )

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      const r = await adminFetch('/api/admin/ai-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(d.error || '保存失败')
      notify('ok', 'AI 密钥已保存')
      setLoadKey((k) => k + 1)
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const resetUsage = async (appId: string) => {
    try {
      const r = await adminFetch('/api/admin/ai-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-usage', appId }),
      })
      if (!r.ok) throw new Error('重置失败')
      await load()
      notify('ok', '用量已重置')
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '重置失败')
    }
  }

  const fetchModels = async (key: string, providerId: string, baseUrl?: string, apiKey?: string) => {
    setModelsBusy(key)
    try {
      const r = await adminFetch('/api/admin/ai-gateway/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, baseUrl, apiKey }),
      })
      const d = (await r.json().catch(() => ({}))) as { models?: string[]; error?: string }
      if (!r.ok) throw new Error(d.error || '拉取失败')
      const models = Array.from(new Set(d.models ?? []))
      if (providerId) setProviderModels((m) => ({ ...m, [providerId]: models }))
      notify('ok', `拉到 ${models.length} 个模型`)
      return models
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '拉取失败')
      return []
    } finally {
      setModelsBusy('')
    }
  }

  const testOne = async (p: ProviderVM) => {
    const key = `p-${p.id}`
    setTests((t) => ({ ...t, [key]: { loading: true } }))
    try {
      const r = await adminFetch('/api/admin/ai-gateway/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: p.id, baseUrl: p.baseUrl, apiKey: p.apiKey, role: p.role, api: p.api, model: p.model }),
      })
      const d = (await r.json().catch(() => ({}))) as { results?: TestVM[]; error?: string }
      const res = d.results?.[0]
      if (!r.ok || !res) throw new Error(d.error || '检测失败')
      setTests((t) => ({ ...t, [key]: { ...res, loading: false } }))
    } catch (err) {
      setTests((t) => ({ ...t, [key]: { ok: false, error: err instanceof Error ? err.message : '检测失败' } }))
    }
  }

  const testAll = async () => {
    if (!config) return
    const ids = config.providers.filter((p) => p.enabled).map((p) => p.id)
    if (!ids.length) {
      notify('err', '没有启用的密钥')
      return
    }
    setTestingAll(true)
    setTests((t) => {
      const n = { ...t }
      for (const id of ids) n[`p-${id}`] = { loading: true }
      return n
    })
    try {
      const r = await adminFetch('/api/admin/ai-gateway/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = (await r.json().catch(() => ({}))) as { results?: (TestVM & { id: string })[]; error?: string }
      if (!r.ok || !d.results) throw new Error(d.error || '检测失败')
      const next: Record<string, TestVM> = {}
      for (const x of d.results) next[`p-${x.id}`] = { ...x, loading: false }
      setTests((t) => ({ ...t, ...next }))
      const bad = d.results.filter((x) => !x.ok).length
      notify(bad ? 'err' : 'ok', bad ? `${d.results.length} 个密钥中 ${bad} 个异常` : `${d.results.length} 个密钥全部正常`)
    } catch (err) {
      notify('err', err instanceof Error ? err.message : '检测失败')
    } finally {
      setTestingAll(false)
    }
  }

  const dirty = !!config && !!data && JSON.stringify(config) !== JSON.stringify(data)
  const providerOptions = config
    ? config.providers.map((p) => ({ value: p.id, label: `${p.name}(${p.id})` }))
    : []

  return (
    <MantineBridge>
      <Stack gap="md" mb="lg">
        <Group gap="xs" wrap="wrap" align="center">
          <Title order={3} style={{ margin: 0, fontSize: '1.1rem' }}>
            AI 密钥
          </Title>
          <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)">
            大模型密钥池 + 各应用接入令牌(OpenAI 兼容代理网关)
          </Text>
          {dirty && (
            <Badge variant="dot" color="yellow" size="sm" ml="auto" style={{ fontFamily: 'var(--font-mono)' }}>
              未保存修改
            </Badge>
          )}
          <Button size="xs" ml={dirty ? undefined : 'auto'} loading={saving} disabled={busy || !config} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </Group>

        <Text c="dimmed" fz="xs" ff="var(--font-mono)">
          网关地址:<Text component="span" c="dimmed" fw={600}>/api/ai/v1</Text>(内网 <Text component="span" fw={600}>http://app:3000/api/ai/v1</Text>)。子应用用它作 baseUrl,key 填对应「接入令牌」。
        </Text>

        {busy && <Text c="dimmed" fz="sm">加载中…</Text>}

        {!busy && config && (
          <>
            <Paper withBorder radius={8} p="md">
              <Group justify="space-between" mb="xs">
                <Text fw={600} fz="sm">密钥池({config.providers.length})</Text>
                <Group gap="xs">
                  <Button size="compact-xs" variant="light" loading={testingAll} onClick={() => void testAll()}>
                    一键检测
                  </Button>
                  <Button size="compact-xs" variant="light" onClick={addProvider}>+ 新增密钥</Button>
                </Group>
              </Group>
              <Stack gap="sm">
                {config.providers.map((p, i) => (
                  <Paper key={i} withBorder radius={6} p="sm">
                    <Stack gap="xs">
                      <Group gap="xs" wrap="wrap" align="center">
                        <TextInput size="xs" w={130} value={p.id} placeholder="id" onChange={(e) => updProvider(i, { id: e.currentTarget.value })} />
                        <TextInput size="xs" w={150} value={p.name} placeholder="名称" onChange={(e) => updProvider(i, { name: e.currentTarget.value })} />
                        <Select size="xs" w={110} data={ROLE_OPTIONS} value={p.role} onChange={(v) => updProvider(i, { role: (v as ProviderVM['role']) || 'chat' })} />
                        {p.role === 'audio' && (
                          <Select size="xs" w={150} data={API_OPTIONS} value={p.api || 'openai'} onChange={(v) => updProvider(i, { api: (v as ProviderVM['api']) || 'openai' })} />
                        )}
                        <Checkbox size="xs" label="启用" checked={p.enabled} onChange={(e) => updProvider(i, { enabled: e.currentTarget.checked })} />
                        <Button size="compact-xs" variant="subtle" color="red" ml="auto" onClick={() => setConfig((c) => (c ? { ...c, providers: c.providers.filter((_, j) => j !== i) } : c))}>
                          删除
                        </Button>
                      </Group>
                      <Group gap="xs" wrap="wrap" align="center">
                        <Select
                          size="xs"
                          w={150}
                          placeholder="供应商预设"
                          data={PROVIDER_PRESETS}
                          value={PROVIDER_PRESETS.some((x) => x.value === p.baseUrl) ? p.baseUrl : null}
                          onChange={(v) => {
                            if (v) updProvider(i, { baseUrl: v })
                          }}
                        />
                        <TextInput size="xs" style={{ flex: 1, minWidth: 220 }} value={p.baseUrl} placeholder="baseUrl,如 https://api.deepseek.com/v1" onChange={(e) => updProvider(i, { baseUrl: e.currentTarget.value })} />
                        <TextInput
                          size="xs"
                          w={220}
                          type="password"
                          autoComplete="off"
                          value={p.apiKey}
                          placeholder={p.hasKey ? `已配置 ${p.keyMask}(留空不改)` : 'API Key'}
                          onChange={(e) => updProvider(i, { apiKey: e.currentTarget.value })}
                        />
                        <Select
                          size="xs"
                          w={220}
                          searchable
                          clearable
                          placeholder="默认模型(可空)"
                          data={uniqModels(providerModels[p.id] ?? p.models)}
                          value={p.model || null}
                          onChange={(v) => updProvider(i, { model: v || '' })}
                        />
                        <Button
                          size="compact-xs"
                          variant="default"
                          loading={modelsBusy === `p-${p.id}`}
                          onClick={() =>
                            void fetchModels(`p-${p.id}`, p.id, p.baseUrl, p.apiKey).then((ms) => {
                              if (ms.length) updProvider(i, { models: ms })
                            })
                          }
                        >
                          拉取模型
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="light"
                          loading={tests[`p-${p.id}`]?.loading}
                          onClick={() => void testOne(p)}
                        >
                          检测
                        </Button>
                      </Group>
                      {tests[`p-${p.id}`] && !tests[`p-${p.id}`]?.loading && (
                        <Text
                          fz="xs"
                          ff="var(--font-mono)"
                          c={tests[`p-${p.id}`]?.ok ? 'teal' : 'red'}
                          title={tests[`p-${p.id}`]?.error}
                          lineClamp={2}
                        >
                          {tests[`p-${p.id}`]?.ok
                            ? `✓ 正常 ${tests[`p-${p.id}`]?.status ?? 200} · ${tests[`p-${p.id}`]?.ms}ms · ${tests[`p-${p.id}`]?.endpoint}`
                            : `✗ ${tests[`p-${p.id}`]?.error || '失败'}`}
                        </Text>
                      )}
                      <Group gap="sm" wrap="wrap" align="center">
                        <Button
                          size="compact-xs"
                          variant={config.chatProviderId === p.id ? 'filled' : 'default'}
                          onClick={() => setConfig({ ...config, chatProviderId: config.chatProviderId === p.id ? '' : p.id })}
                        >
                          {config.chatProviderId === p.id ? '● 默认对话' : '设为默认对话'}
                        </Button>
                        <Button
                          size="compact-xs"
                          variant={config.embedProviderId === p.id ? 'filled' : 'default'}
                          onClick={() => setConfig({ ...config, embedProviderId: config.embedProviderId === p.id ? '' : p.id })}
                        >
                          {config.embedProviderId === p.id ? '● 默认向量' : '设为默认向量'}
                        </Button>
                        {p.role === 'audio' && (
                          <Button
                            size="compact-xs"
                            variant={config.audioProviderId === p.id ? 'filled' : 'default'}
                            onClick={() => setConfig({ ...config, audioProviderId: config.audioProviderId === p.id ? '' : p.id })}
                          >
                            {config.audioProviderId === p.id ? '● 默认音频' : '设为默认音频'}
                          </Button>
                        )}
                      </Group>
                    </Stack>
                  </Paper>
                ))}
                {config.providers.length === 0 && (
                  <Text c="dimmed" fz="xs">还没有密钥。点「新增密钥」录入一个 OpenAI 兼容端点(baseUrl 需含 /v1 之类路径前缀)。</Text>
                )}
              </Stack>
            </Paper>

            <Paper withBorder radius={8} p="md">
              <Group justify="space-between" mb="xs">
                <Text fw={600} fz="sm">应用令牌({config.apps.length})</Text>
                <Button size="compact-xs" variant="light" onClick={addApp}>+ 新增应用</Button>
              </Group>
              <Stack gap="sm">
                {config.apps.map((a, i) => (
                  <Paper key={i} withBorder radius={6} p="sm">
                    <Stack gap="xs">
                      <Group gap="xs" wrap="wrap" align="center">
                        <TextInput size="xs" w={130} value={a.id} placeholder="id" onChange={(e) => updApp(i, { id: e.currentTarget.value })} />
                        <TextInput size="xs" w={150} value={a.name} placeholder="应用名" onChange={(e) => updApp(i, { name: e.currentTarget.value })} />
                        <Checkbox size="xs" label="启用" checked={a.enabled} onChange={(e) => updApp(i, { enabled: e.currentTarget.checked })} />
                        <Text component="span" c="dimmed" fz="xs" ff="var(--font-mono)" ml="auto">
                          今日 {a.usage?.today ?? 0} / 累计 {a.usage?.total ?? 0} tokens
                          {(a.usage?.audioTotal ?? 0) > 0
                            ? ` · 音频 ${Math.round((a.usage?.audioTotal ?? 0) / 60)} 分钟`
                            : ''}
                        </Text>
                        <Button size="compact-xs" variant="subtle" onClick={() => void resetUsage(a.id)}>重置用量</Button>
                        <Button size="compact-xs" variant="subtle" color="red" onClick={() => setConfig((c) => (c ? { ...c, apps: c.apps.filter((_, j) => j !== i) } : c))}>
                          删除
                        </Button>
                      </Group>
                      <Group gap="xs" wrap="wrap" align="center">
                        <TextInput size="xs" style={{ flex: 1, minWidth: 260 }} value={a.token} readOnly placeholder="令牌" />
                        <Button size="compact-xs" onClick={() => copyText(a.token, () => notify('ok', '令牌已复制'), () => notify('err', '复制失败'))}>复制</Button>
                        <Button size="compact-xs" variant="default" onClick={() => updApp(i, { token: randomToken() })}>重新生成</Button>
                      </Group>
                      <Group gap="xs" wrap="wrap" align="center">
                        <Select
                          size="xs"
                          w={220}
                          clearable
                          placeholder="绑定的密钥(留空=按模型自动)"
                          data={providerOptions}
                          value={a.providerId || null}
                          onChange={(v) => updApp(i, { providerId: v || '' })}
                        />
                        <Select
                          size="xs"
                          w={200}
                          searchable
                          clearable
                          placeholder="固定模型(可空=应用自选)"
                          data={uniqModels(providerModels[a.providerId] ?? config.providers.find((x) => x.id === a.providerId)?.models ?? [])}
                          value={a.model || null}
                          onChange={(v) => updApp(i, { model: v || '' })}
                        />
                        <Button
                          size="compact-xs"
                          variant="default"
                          loading={modelsBusy === `a-${a.id}`}
                          onClick={() => {
                            const pid = a.providerId || config.chatProviderId || config.providers[0]?.id || ''
                            if (!pid) {
                              notify('err', '请先选择或新建密钥')
                              return
                            }
                            void fetchModels(`a-${a.id}`, pid, '', '')
                          }}
                        >
                          拉取模型
                        </Button>
                        <TextInput
                          size="xs"
                          w={130}
                          value={a.dailyLimit ? String(a.dailyLimit) : ''}
                          placeholder="每日 token 上限"
                          onChange={(e) => updApp(i, { dailyLimit: Number(e.currentTarget.value.replace(/[^0-9]/g, '')) || 0 })}
                        />
                        <TextInput
                          size="xs"
                          w={130}
                          value={a.totalLimit ? String(a.totalLimit) : ''}
                          placeholder="总量 token 上限"
                          onChange={(e) => updApp(i, { totalLimit: Number(e.currentTarget.value.replace(/[^0-9]/g, '')) || 0 })}
                        />
                        <TextInput
                          size="xs"
                          w={130}
                          value={a.audioLimit ? String(a.audioLimit) : ''}
                          placeholder="音频分钟上限"
                          onChange={(e) => updApp(i, { audioLimit: Number(e.currentTarget.value.replace(/[^0-9]/g, '')) || 0 })}
                        />
                        <TextInput size="xs" w={180} value={a.note} placeholder="备注" onChange={(e) => updApp(i, { note: e.currentTarget.value })} />
                      </Group>
                    </Stack>
                  </Paper>
                ))}
                {config.apps.length === 0 && (
                  <Text c="dimmed" fz="xs">还没有应用令牌。点「新增应用」后复制令牌,填进子应用的 AI 配置。</Text>
                )}
              </Stack>
            </Paper>

            <Box>
              <Text c="dimmed" fz="xs" ff="var(--font-mono)">
                上限填 0 = 不限。额度按上游返回的 token 数累计,北京时间日切。密钥只存服务器数据库,子应用不接触真实 key。
              </Text>
            </Box>
          </>
        )}
      </Stack>
    </MantineBridge>
  )
}
