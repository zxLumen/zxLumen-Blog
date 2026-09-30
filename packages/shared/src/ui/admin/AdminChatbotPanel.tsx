'use client'

// 机器人后台面板:对话/provider 配置 + 检索(embedding)配置 + 灵魂蒸馏 + 对话日志。
import { useCallback, useEffect, useState } from 'react'
import { MantineBridge } from './mantine-bridge.js'
import { adminFetch } from './admin-fetch.js'
import type { NotifyMsg } from './admin-types.js'

interface ProviderOption {
  id: string
  name: string
  protocol: string
  baseUrl: string
  embeddings: boolean
}

interface BotConfig {
  enabled: boolean
  name: string
  greeting: string
  greetings: string[]
  autoOpen: boolean
  smartGreeting: boolean
  greetBirthday: string
  suggestions: string[]
  chatProvider: string
  chatBaseUrl: string
  chatModel: string
  temperature: number
  maxTokens: number
  embedProvider: string
  embedBaseUrl: string
  embedModel: string
  embedDim: number
  dailyCap: number
  rag: boolean
  topK: number
  promptExtra: string
  chatApiKey?: string
  embedApiKey?: string
}

interface Payload {
  config: BotConfig
  providers: ProviderOption[]
  embeddingProviders: ProviderOption[]
  chatReady: boolean
  embedReady: boolean
  lastError: string
}

interface CorpusItem {
  name: string
  rel: string
  kind: 'persona' | 'knowledge' | null
  origin: 'override' | 'directive' | 'rule' | 'auto'
  status: string
  error: string
  /** 垃圾检测(auto=自动跳过 / hint=仅提示),null=正常 */
  junk?: { auto: boolean; reason: string } | null
  /** true=已由站长恢复入库(豁免自动过滤) */
  nokeep?: boolean
}

interface SanitizedInfo {
  hard: Record<string, number>
  ctx: Record<string, number>
  at: string
}

interface KbDoc {
  source: string
  kind: string
  status: string
  size: number
  error: string
  sha: string
}

interface DistillProgress {
  running: boolean
  force: boolean
  total: number
  done: number
  ok: number
  ignored: number
  error: number
  current: string
  startedAt: string
  finishedAt: string | null
  cancelRequested?: boolean
  cancelled?: boolean
}

interface PersonaStatus {
  running: boolean
  startedAt: string
  finishedAt: string | null
  ok: boolean
  faq: number
  error: string
  cancelRequested?: boolean
  cancelled?: boolean
}

interface DistillStatus {
  corpus: CorpusItem[]
  docs: KbDoc[]
  kindOverrides: Record<string, 'persona' | 'knowledge'>
  sensitiveAllowed?: Record<string, boolean>
  sanitized?: Record<string, SanitizedInfo>
  chunkCount: number
  hasPersona: boolean
  faqCount: number
  personaAt?: string
  faqAt?: string
  persona?: PersonaStatus | null
  busy?: { running: boolean; kind: 'distill' | 'persona' | null }
  progress?: DistillProgress | null
}

interface LogRow {
  id: number
  role: string
  content: string
  cid: string
  day: string
  provider: string
  model: string
  in_tokens: number
  out_tokens: number
  latency_ms: number
  created_at: string
}

function gate(showTabs: boolean, tab: string): boolean {
  return showTabs && tab === 'chatbot'
}

/** 类别判定来源的展示文案 */
const ORIGIN_TEXT: Record<string, string> = { override: '手动', directive: '指令', rule: '规则', auto: 'AI' }

const num = (s: string, fallback: number) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

/** Chrome/Edge 原生目录选择:递归收集 .md/.txt,并把相对路径挂到 File 上(兼容 webkitRelativePath 语义) */
async function pickDirectoryFiles(): Promise<File[]> {
  interface DirHandle extends AsyncIterable<[string, unknown]> {
    kind: 'file' | 'directory'
    getFile?: () => Promise<File>
  }
  const w = window as Window & { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<DirHandle> }
  if (!w.showDirectoryPicker) return []
  const handle = await w.showDirectoryPicker({ mode: 'read' })
  const out: File[] = []
  const walk = async (dir: DirHandle, prefix: string) => {
    for await (const [name, entry] of dir) {
      const e = entry as DirHandle
      if (e.kind === 'directory') await walk(e, prefix ? `${prefix}/${name}` : name)
      else if (/\.(md|txt)$/i.test(name) && e.getFile) {
        const f = await e.getFile()
        Object.defineProperty(f, 'webkitRelativePath', { value: prefix ? `${prefix}/${name}` : name, configurable: true })
        out.push(f)
      }
    }
  }
  await walk(handle, '')
  if (!out.length) throw new Error('所选文件夹里没有 .md/.txt 文件')
  return out
}

/** 按状态分组展示 corpus 文件:出错/待处理/已入库可折叠,行可点击查看原文 */
function CorpusFileList({
  items,
  filter,
  dBusy,
  kindOverrides,
  sanitized,
  sensitiveAllowed,
  collapse,
  onToggleCollapse,
  onSetKind,
  onDelete,
  onAllow,
  onUnignore,
  onIgnore,
  onOpen,
}: {
  items: CorpusItem[]
  filter: string
  dBusy: string
  kindOverrides?: Record<string, 'persona' | 'knowledge'>
  sanitized?: Record<string, SanitizedInfo>
  sensitiveAllowed?: Record<string, boolean>
  collapse: string[]
  onToggleCollapse: (k: string) => void
  onSetKind: (source: string, kind: 'persona' | 'knowledge' | 'auto') => void
  onDelete: (rel: string) => void
  onAllow: (rel: string, allow: boolean) => void
  onUnignore: (rel: string) => void
  onIgnore: (rel: string) => void
  onOpen: (rel: string) => void
}) {
  const kw = filter.trim().toLowerCase()
  const shown = kw
    ? items.filter((c) => c.rel.toLowerCase().includes(kw))
    : items
  const groups: Array<{ key: string; color: string; list: CorpusItem[] }> = [
    { key: '出错', color: 'var(--zx-danger, #e5484d)', list: shown.filter((c) => c.status === 'error') },
    { key: '已忽略', color: 'var(--zx-text-dim, #999)', list: shown.filter((c) => c.status === 'ignored' && !c.nokeep) },
    { key: '待处理', color: 'var(--zx-text-dim, #999)', list: shown.filter((c) => c.status !== 'error' && c.status !== 'processed' && c.status !== 'ignored') },
    { key: '已入库', color: 'var(--zx-ok, #2f9e44)', list: shown.filter((c) => c.status === 'processed') },
  ].filter((g) => g.list.length > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {groups.map((g) => {
        const open = !collapse.includes(g.key)
        return (
          <div key={g.key}>
            <button
              className="zx-btn zx-btn-sm zx-btn-ghost"
              style={{ padding: '2px 6px', fontWeight: 600 }}
              onClick={() => onToggleCollapse(g.key)}
            >
              {open ? '▾' : '▸'} <span style={{ color: g.color }}>{g.key}</span> ({g.list.length})
            </button>
            {open && (
              <div style={{ marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {g.list.map((c) => {
                  const idx = `${g.key}-${c.rel}`
                  const info = sanitized?.[c.rel]
                  const allowed = !!sensitiveAllowed?.[c.rel]
                  const parts: string[] = []
                  for (const [k, v] of Object.entries(info?.hard ?? {})) parts.push(`脱敏${k}×${v}`)
                  for (const [k, v] of Object.entries(info?.ctx ?? {})) parts.push(`脱敏${k}×${v}(语境)`)
                  const junkHint = c.junk && !c.junk.auto ? c.junk.reason : ''
                  return (
                    <div
                      key={idx}
                      title={c.rel}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '2px 4px',
                        borderRadius: 4,
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--zx-bg-hover, rgba(0,0,0,0.04))')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => onOpen(c.rel)}
                    >
                      <button
                        className="zx-mono"
                        style={{
                          border: 'none',
                          background: 'none',
                          padding: 0,
                          textAlign: 'left',
                          color: 'inherit',
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          maxWidth: '42%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: '0 1 auto',
                        }}
                        title={`查看 ${c.rel}`}
                      >
                        {c.rel.replace(/^corpus\//, '')}
                      </button>
                      <span style={{ color: g.color, flexShrink: 0 }}>
                        {c.status === 'processed' ? '✓' : c.status === 'error' ? '✕' : c.status === 'ignored' ? '⛔' : '…'}
                      </span>
                      <span className="zx-muted zx-mono" style={{ flexShrink: 0, fontSize: '0.62rem' }}>
                        {c.status === 'ignored'
                          ? (c.error || '已忽略')
                          : c.kind === null
                            ? '?'
                            : c.kind === 'persona'
                              ? '人格'
                              : '知识'}
                        {c.origin && c.status !== 'ignored' ? `·${ORIGIN_TEXT[c.origin] ?? c.origin}` : ''}
                      </span>
                      {(parts.length > 0 || allowed) && (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: '0.62rem',
                            color: allowed ? 'var(--zx-text-dim, #888)' : '#b45309',
                            maxWidth: '22%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={allowed ? '已按原文放行' : `检测时间 ${info?.at ?? ''};均脱敏后入库`}
                        >
                          {allowed ? '已放行' : `⚠ ${parts.join('、') || '…'}`}
                        </span>
                      )}
                      {junkHint && (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: '0.62rem',
                            color: '#b45309',
                            maxWidth: '22%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={junkHint}
                        >
                          ⚠ 疑似垃圾:{junkHint}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                        {c.status === 'ignored' && !c.nokeep ? (
                          <button
                            className="zx-btn zx-btn-sm zx-btn-ghost"
                            style={{ padding: '0 0.3rem', minWidth: 0 }}
                            disabled={!!dBusy}
                            title="此文件因疑似垃圾被自动忽略;恢复后重新入库"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onUnignore(c.rel)
                            }}
                          >
                            恢复入库
                          </button>
                        ) : (
                          <select
                            className="zx-input"
                            style={{ maxWidth: 92, fontSize: '0.68rem', padding: '1px 2px' }}
                            disabled={!!dBusy}
                            value={kindOverrides?.[c.rel] ?? 'auto'}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation()
                              void onSetKind(c.rel, e.target.value as 'persona' | 'knowledge' | 'auto')
                            }}
                          >
                            <option value="auto">自动</option>
                            <option value="persona">人格</option>
                            <option value="knowledge">知识</option>
                          </select>
                        )}
                        {c.status !== 'ignored' && !allowed && parts.length > 0 && (
                          <button
                            className="zx-btn zx-btn-sm zx-btn-ghost"
                            style={{ padding: '0 0.3rem', minWidth: 0 }}
                            disabled={!!dBusy}
                            title="示例数字/教程写法误报时,按原文蒸馏"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onAllow(c.rel, true)
                            }}
                          >
                            放行
                          </button>
                        )}
                        {c.status !== 'ignored' && allowed && (
                          <button
                            className="zx-btn zx-btn-sm zx-btn-ghost"
                            style={{ padding: '0 0.3rem', minWidth: 0 }}
                            disabled={!!dBusy}
                            title="恢复脱敏"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onAllow(c.rel, false)
                            }}
                          >
                            恢复
                          </button>
                        )}
                        {c.status !== 'ignored' && c.nokeep && (
                          <button
                            className="zx-btn zx-btn-sm zx-btn-ghost"
                            style={{ padding: '0 0.3rem', minWidth: 0 }}
                            disabled={!!dBusy}
                            title="此前已「恢复入库」,点此重新按自动过滤忽略"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onIgnore(c.rel)
                            }}
                          >
                            恢复过滤
                          </button>
                        )}
                        <button
                          className="zx-btn zx-btn-sm zx-btn-ghost"
                          style={{ padding: '0 0.3rem', minWidth: 0 }}
                          disabled={!!dBusy}
                          title={`删除 ${c.rel}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void onDelete(c.rel)
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 查看 corpus 文件的弹层:展示原文文本(顶栏显示文件名 + 操作) */
function CorpusViewer({
  rel,
  name,
  state,
  text,
  onClose,
  onDelete,
}: {
  rel: string
  name: string
  state: 'idle' | 'loading' | 'error'
  text: string
  onClose: () => void
  onDelete: (rel: string) => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
      onClick={onClose}
    >
      <div
        className="zx-panel"
        style={{ maxWidth: 860, width: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', marginBottom: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
          <strong className="zx-mono" style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </strong>
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>{rel} · {text.length} 字符</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
            <button
              className="zx-btn zx-btn-sm zx-btn-ghost"
              onClick={() => {
                if (confirm(`删除 ${rel}?会同步移除其知识块。`)) onDelete(rel)
              }}
            >
              删除
            </button>
            <button className="zx-btn zx-btn-sm zx-btn-primary" onClick={onClose}>关闭</button>
          </span>
        </div>
        {state === 'loading' && <div className="zx-muted zx-mono" style={{ fontSize: '0.72rem' }}>加载中…</div>}
        {state === 'error' && <div className="zx-msg err" style={{ fontSize: '0.72rem' }}>读取失败(文件可能已删除)</div>}
        {state === 'idle' && (
          <pre
            className="zx-mono"
            style={{
              flex: 1,
              overflow: 'auto',
              margin: 0,
              padding: '0.8rem',
              background: 'var(--zx-bg, transparent)',
              border: '1px solid var(--zx-border, #ddd)',
              borderRadius: 6,
              fontSize: '0.74rem',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {text}
          </pre>
        )}
      </div>
    </div>
  )
}

export function AdminChatbotPanel({
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
  const gated = gate(showTabs, tab)
  const notify = useCallback((k: 'ok' | 'err', t: string) => onNotify?.({ kind: k, text: t }), [onNotify])

  const [cfg, setCfg] = useState<BotConfig | null>(null)
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [embProviders, setEmbProviders] = useState<ProviderOption[]>([])
  const [chatKey, setChatKey] = useState('')
  const [embedKey, setEmbedKey] = useState('')
  const [lastError, setLastError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [distill, setDistill] = useState<DistillStatus | null>(null)
  const [dBusy, setDBusy] = useState<'process' | 'persona' | 'clear' | 'kind' | 'upload' | 'del' | ''>('')
  const [force, setForce] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [corpusFilter, setCorpusFilter] = useState('')
  const [corpusCollapse, setCorpusCollapse] = useState<string[]>(['已入库'])
  const [viewer, setViewer] = useState<{ rel: string; name: string } | null>(null)
  const [viewState, setViewState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [viewText, setViewText] = useState('')

  const [logs, setLogs] = useState<LogRow[]>([])
  const [dayCounts, setDayCounts] = useState<Array<{ day: string; count: number }>>([])
  const [logsBusy, setLogsBusy] = useState(false)

  const [chatModels, setChatModels] = useState<string[]>([])
  const [embedModels, setEmbedModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState<'chat' | 'embed' | ''>('')
  const [modelsErr, setModelsErr] = useState<{ chat: string; embed: string }>({ chat: '', embed: '' })
  const [chatCustom, setChatCustom] = useState(false)
  const [embedCustom, setEmbedCustom] = useState(false)

  const loadModels = useCallback(async (kind: 'chat' | 'embed', opts?: { provider?: string; baseUrl?: string }) => {
    setModelsBusy(kind)
    setModelsErr((e) => ({ ...e, [kind]: '' }))
    try {
      const q = new URLSearchParams({ kind })
      if (opts?.provider) q.set('provider', opts.provider)
      if (opts?.baseUrl) q.set('baseUrl', opts.baseUrl)
      const r = await adminFetch(`/api/admin/chatbot/models?${q.toString()}`, { cache: 'no-store' })
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; models?: string[]; error?: string }
      if (!r.ok || !d.ok) throw new Error(d.error || '模型列表加载失败')
      const list = d.models ?? []
      if (kind === 'chat') {
        setChatModels(list)
        if (!list.length) setChatCustom(true)
      } else {
        setEmbedModels(list)
        if (!list.length) setEmbedCustom(true)
      }
    } catch (e) {
      setModelsErr((x) => ({ ...x, [kind]: e instanceof Error ? e.message : '模型列表加载失败' }))
    } finally {
      setModelsBusy('')
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await adminFetch('/api/admin/chatbot', { cache: 'no-store' })
      if (!r.ok) throw new Error('加载失败')
      const d = (await r.json()) as Payload
      setCfg(d.config)
      setProviders(d.providers)
      setEmbProviders(d.embeddingProviders)
      setLastError(d.lastError)
      if (d.chatReady) void loadModels('chat')
      if (d.embedReady) void loadModels('embed')
    } catch {
      notify('err', '机器人配置加载失败')
    } finally {
      setLoading(false)
    }
  }, [notify, loadModels])

  const loadDistill = useCallback(async () => {
    try {
      const r = await adminFetch('/api/admin/chatbot/distill', { cache: 'no-store' })
      if (r.ok) setDistill((await r.json()) as DistillStatus)
    } catch {
      /* 忽略 */
    }
  }, [])

  const loadLogs = useCallback(async () => {
    setLogsBusy(true)
    try {
      const r = await adminFetch('/api/admin/chatbot/logs?limit=30&days=14', {
        cache: 'no-store',
      })
      if (r.ok) {
        const d = (await r.json()) as { logs: LogRow[]; dayCounts: Array<{ day: string; count: number }> }
        setLogs(d.logs ?? [])
        setDayCounts(d.dayCounts ?? [])
      }
    } catch {
      /* 忽略 */
    } finally {
      setLogsBusy(false)
    }
  }, [])

  useEffect(() => {
    if (gated && active) {
      void load()
      void loadDistill()
      void loadLogs()
    }
  }, [gated, active, load, loadDistill, loadLogs])

  // 蒸馏/人格在后台跑时,1.5s 轮询进度(任意标签页都能看到)
  const personaRunning = !!distill?.persona?.running
  const distillRunning = !!distill?.progress?.running
  const anyRunning = distillRunning || personaRunning
  useEffect(() => {
    if (!gated || !active || !anyRunning) return
    const t = setInterval(() => void loadDistill(), 1500)
    return () => clearInterval(t)
  }, [gated, active, anyRunning, loadDistill])

  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) =>
    setCfg((c) => (c ? { ...c, [k]: v } : c))

  const selectProvider = (kind: 'chatProvider' | 'embedProvider', id: string) => {
    setCfg((c) => {
      if (!c) return c
      const p = (kind === 'chatProvider' ? providers : embProviders).find((x) => x.id === id)
      const next = { ...c, [kind]: id } as BotConfig
      const k = kind === 'chatProvider' ? 'chatBaseUrl' : 'embedBaseUrl'
      if (p) next[k] = p.id === 'custom' ? '' : p.baseUrl
      return next
    })
    // provider 变了 → 旧模型列表失效;清空,待保存 key 后点 ↻ 重拉
    if (kind === 'chatProvider') {
      setChatModels([])
      setChatCustom(false)
    } else {
      setEmbedModels([])
      setEmbedCustom(false)
    }
  }

  const save = async () => {
    if (!cfg) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...cfg }
      // 掩码(••••/****)只是显示用,绝不能回写;仅当用户实际输入新 key 时才带
      delete body.chatApiKey
      delete body.embedApiKey
      if (chatKey.trim()) body.chatApiKey = chatKey.trim()
      if (embedKey.trim()) body.embedApiKey = embedKey.trim()
      const r = await adminFetch('/api/admin/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; status?: Payload }
      if (!r.ok) throw new Error(d.error || '保存失败')
      if (d.status) {
        setCfg(d.status.config)
        setLastError(d.status.lastError)
      }
      setChatKey('')
      setEmbedKey('')
      void loadModels('chat')
      void loadModels('embed')
      notify('ok', '机器人配置已保存')
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const distillAction = async (action: 'process' | 'persona' | 'clear') => {
    if (action === 'process' && force && !window.confirm('全量重跑会重新分类并重建全部知识块(耗时且消耗较多 token),确认继续?')) return
    setDBusy(action)
    const signal = AbortSignal.timeout(10 * 60_000)
    try {
      const r = await adminFetch('/api/admin/chatbot/distill', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, force: action === 'process' ? force : undefined }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean; action?: string; started?: boolean; reason?: string }
      if (!r.ok || !d.ok) throw new Error(d.error || '操作失败')
      await loadDistill()
      if (action === 'process') {
        notify(d.started ? 'ok' : 'err', d.started ? (force ? '已开始全量重跑(后台进行,进度见下方)' : '已开始蒸馏(后台进行,进度见下方)') : d.reason || '已有蒸馏任务在跑')
      } else if (action === 'persona') {
        notify(d.started ? 'ok' : 'err', d.started ? '已开始生成人格(后台进行,完成后下方显示时间与 FAQ 数)' : d.reason || '已有任务在跑')
      } else {
        notify('ok', '知识库已清空')
      }
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '操作失败')
    } finally {
      setDBusy('')
    }
  }

  const cancelJob = async () => {
    if (!window.confirm('取消当前后台任务?(已完成的不会回滚)')) return
    try {
      const r = await adminFetch('/api/admin/chatbot/distill', {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; cancelled?: boolean; error?: string }
      if (!r.ok || !d.ok) throw new Error(d.error || '取消失败')
      await loadDistill()
      notify(d.cancelled ? 'ok' : 'err', d.cancelled ? '已请求取消,正在收尾…' : '当前没有在跑的任务')
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '取消失败')
    }
  }

  const setKind = async (source: string, kind: 'persona' | 'knowledge' | 'auto') => {
    setDBusy('kind')
    try {
      const r = await adminFetch('/api/admin/chatbot/distill', {
        method: 'POST',
        signal: AbortSignal.timeout(10 * 60_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-kind', source, kind }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean }
      if (!r.ok || !d.ok) throw new Error(d.error || '设置失败')
      await loadDistill()
      notify('ok', kind === 'auto' ? '已恢复自动分类' : `已设为${kind === 'persona' ? '人格' : '知识'}并重新入库`)
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '设置失败')
    } finally {
      setDBusy('')
    }
  }

  const setSensitiveAllow = async (source: string, allow: boolean) => {
    setDBusy('kind')
    try {
      const r = await adminFetch('/api/admin/chatbot/distill', {
        method: 'POST',
        signal: AbortSignal.timeout(10 * 60_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-sensitive-allow', source, allow }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean }
      if (!r.ok || !d.ok) throw new Error(d.error || '设置失败')
      await loadDistill()
      notify('ok', allow ? '已按原文放行(误报时使用)' : '已恢复脱敏并重新入库')
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '设置失败')
    } finally {
      setDBusy('')
    }
  }

  const unignoreCorpus = async (source: string) => {
    setDBusy('kind')
    try {
      const r = await adminFetch('/api/admin/chatbot/distill', {
        method: 'POST',
        signal: AbortSignal.timeout(10 * 60_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-ignored', source, ignore: false }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean }
      if (!r.ok || !d.ok) throw new Error(d.error || '恢复失败')
      await loadDistill()
      notify('ok', '已豁免自动过滤并重新入库')
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '恢复失败')
    } finally {
      setDBusy('')
    }
  }

  const ignoreCorpus = async (source: string) => {
    setDBusy('kind')
    try {
      const r = await adminFetch('/api/admin/chatbot/distill', {
        method: 'POST',
        signal: AbortSignal.timeout(10 * 60_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-ignored', source, ignore: true }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean }
      if (!r.ok || !d.ok) throw new Error(d.error || '操作失败')
      await loadDistill()
      notify('ok', '已恢复自动过滤并移出知识库')
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '操作失败')
    } finally {
      setDBusy('')
    }
  }

  const clearLogs = async () => {
    if (!confirm('清空全部对话日志?')) return
    const r = await adminFetch('/api/admin/chatbot/logs', { method: 'DELETE' })
    if (r.ok) {
      setLogs([])
      notify('ok', '日志已清空')
    }
  }

  const uploadCorpus = async () => {
    if (!pendingFiles.length) return
    setDBusy('upload')
    try {
      const fd = new FormData()
      for (const f of pendingFiles) fd.append('files', f, f.webkitRelativePath || f.name)
      const r = await adminFetch('/api/admin/chatbot/corpus', {
        method: 'POST',
        signal: AbortSignal.timeout(10 * 60_000),
        body: fd,
      })
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        uploaded?: Array<{ name: string; size: number; sanitized?: Array<{ label: string; n: number }> }>
        errors?: Array<{ name: string; error: string }>
      }
      if (!r.ok || !d.ok) throw new Error(d.error || '上传失败')
      await loadDistill()
      const n = d.uploaded?.length ?? 0
      notify('ok', n ? `已上传 ${n} 个文件并自动蒸馏` : '上传为空')
      if (d.errors?.length) notify('err', d.errors.map((e) => `${e.name}: ${e.error}`).join('; '))
      const flagged = (d.uploaded ?? []).filter((u) => u.sanitized?.length)
      if (flagged.length) {
        notify(
          'err',
          flagged
            .map((u) => `${u.name}: 检测到敏感信息(${(u.sanitized ?? []).map((s) => `${s.label}×${s.n}`).join('、')}),已脱敏后入库,可在下方「放行」`)
            .join('; '),
        )
      }
      setPendingFiles([])
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '上传失败')
    } finally {
      setDBusy('')
    }
  }

  const deleteCorpus = async (rel: string) => {
    if (!confirm(`删除 ${rel}?会同步移除其知识块。`)) return
    setDBusy('del')
    try {
      const r = await adminFetch(`/api/admin/chatbot/corpus?${new URLSearchParams({ name: rel })}`, { method: 'DELETE' })
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || !d.ok) throw new Error(d.error || '删除失败')
      setPendingFiles((pf) => pf.filter((f) => (f.webkitRelativePath || f.name) !== rel.replace(/^corpus\//, '')))
      await loadDistill()
      notify('ok', `已删除 ${rel}`)
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '删除失败')
    } finally {
      setDBusy('')
    }
  }

  const openViewer = async (rel: string) => {
    setViewer({ rel, name: rel.replace(/^corpus\//, '') })
    setViewState('loading')
    setViewText('')
    try {
      const q = new URLSearchParams({ name: rel })
      const r = await adminFetch(`/api/admin/chatbot/corpus?${q.toString()}`, { cache: 'no-store' })
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string }
      if (!r.ok || !d.ok) throw new Error(d.error || '读取失败')
      setViewText(d.text ?? '')
      setViewState('idle')
    } catch {
      setViewText('')
      setViewState('error')
    }
  }

  if (!cfg) {
    return (
      <MantineBridge>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.75rem' }}>
          {loading ? '加载中…' : ''}
        </p>
      </MantineBridge>
    )
  }

  return (
    <MantineBridge>
      <p className="zx-muted zx-mono" style={{ fontSize: '0.75rem' }}>
        // 问答机器人「{cfg.name}」· {cfg.enabled ? '已启用' : '未启用'} · 聊天 {cfg.chatModel ? cfg.chatModel : '(未设模型)'} · 检索
        {cfg.rag ? (cfg.embedModel ? `dense(${cfg.embedModel})` : 'keyword-only') : '关'}
        {lastError && <span className="zx-msg err" style={{ display: 'block', marginTop: '0.5rem' }}>{lastError}</span>}
      </p>

      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>对话配置 <span>提供方 · 密钥 · 限流</span></h3>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
          <label className="zx-check">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            <span>启用机器人</span>
          </label>
          <label className="zx-check">
            <input type="checkbox" checked={cfg.autoOpen} onChange={(e) => set('autoOpen', e.target.checked)} />
            <span>进入页面自动弹出</span>
          </label>
          <label className="zx-check" title="按 日期/天气/节日 用 AI 生成问候(缓存复用;失败或未配模型时回退到下面的语气样本)">
            <input type="checkbox" checked={cfg.smartGreeting} onChange={(e) => set('smartGreeting', e.target.checked)} />
            <span>智能问候</span>
          </label>
          <input className="zx-input" style={{ maxWidth: 200 }} placeholder="名字(Lumen · 子祥的分身)" value={cfg.name} onChange={(e) => set('name', e.target.value)} />
          <input className="zx-input" style={{ maxWidth: 120 }} placeholder="每日上限" value={cfg.dailyCap} onChange={(e) => set('dailyCap', num(e.target.value, 0))} />
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>每日/每人提问,0=不限</span>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
          <select className="zx-input" style={{ maxWidth: 180 }} value={cfg.chatProvider} onChange={(e) => selectProvider('chatProvider', e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input className="zx-input" style={{ maxWidth: 280, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} placeholder="Base URL" value={cfg.chatBaseUrl} onChange={(e) => set('chatBaseUrl', e.target.value)} />
          <select className="zx-input" style={{ maxWidth: 210, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            value={chatCustom ? '__custom__' : cfg.chatModel}
            onChange={(e) => {
              const v = e.target.value
              if (v === '__custom__') setChatCustom(true)
              else {
                setChatCustom(false)
                set('chatModel', v)
              }
            }}>
            <option value="">(选择模型)</option>
            {chatModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {cfg.chatModel && !chatModels.includes(cfg.chatModel) && <option value={cfg.chatModel}>{cfg.chatModel}(当前)</option>}
            <option value="__custom__">自定义…</option>
          </select>
          <button type="button" className="zx-btn zx-btn-sm" disabled={modelsBusy === 'chat'} title="按已保存的 baseUrl/key 拉取模型列表"
            onClick={() => void loadModels('chat', { provider: cfg.chatProvider, baseUrl: cfg.chatBaseUrl })}>
            {modelsBusy === 'chat' ? '…' : '↻'}
          </button>
          {chatCustom && (
            <input className="zx-input" style={{ maxWidth: 200, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} placeholder="手动输入模型名" value={cfg.chatModel} onChange={(e) => set('chatModel', e.target.value)} />
          )}
          {modelsErr.chat && <span className="zx-msg err" style={{ fontSize: '0.66rem' }}>{modelsErr.chat}</span>}
          <label className="zx-muted zx-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.66rem' }} title="temperature:0–2,越高越随机,越低越稳定">
            温度
            <input className="zx-input" style={{ maxWidth: 80 }} type="number" step="0.1" min="0" max="2" value={cfg.temperature} onChange={(e) => set('temperature', num(e.target.value, 0.7))} />
          </label>
          <label className="zx-muted zx-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.66rem' }} title="单次回复最大长度(tokens,含推理模型思维链)。推理模型建议 ≥4096,否则思维链可能吃满导致空回答。">
            最大输出
            <input className="zx-input" style={{ maxWidth: 100 }} type="number" value={cfg.maxTokens} onChange={(e) => set('maxTokens', num(e.target.value, 1024))} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="zx-input" type="password" style={{ maxWidth: 280, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            placeholder={cfg.chatApiKey ? `已配置 ${cfg.chatApiKey}(留空不改)` : '聊天 API Key'} value={chatKey} onChange={(e) => setChatKey(e.target.value)} autoComplete="off" />
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>回退环境变量 CHATBOT_API_KEY;Key 仅存服务器</span>
        </div>
        <textarea className="zx-input zx-textarea" style={{ marginTop: '0.6rem' }} rows={4} placeholder="语气样本(每行一条;供 AI 生成问候时参考口吻,不直接展示)" value={(cfg.greetings ?? []).join('\n')} onChange={(e) => set('greetings', e.target.value.split(/[\n、]/).map((s) => s.trim()).filter(Boolean))} />
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' }}>
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>生日/纪念日</span>
          <input className="zx-input" style={{ maxWidth: 200 }} placeholder="YYYY-MM-DD 或 MM-DD(留空忽略)" value={cfg.greetBirthday} onChange={(e) => set('greetBirthday', e.target.value)} />
        </div>
        <textarea className="zx-input zx-textarea" style={{ marginTop: '0.4rem' }} rows={2} placeholder="建议问题(逗号/换行分隔)" value={(cfg.suggestions ?? []).join('、')} onChange={(e) => set('suggestions', e.target.value.split(/[、\n]/).map((s) => s.trim()).filter(Boolean))} />
        <textarea className="zx-input zx-textarea" style={{ marginTop: '0.4rem' }} rows={2} placeholder="额外人格指令(可选,追加到 system prompt)" value={cfg.promptExtra} onChange={(e) => set('promptExtra', e.target.value)} />
      </div>

      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>知识检索(RAG) <span>embedding 未配置时仅关键词</span></h3>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
          <label className="zx-check">
            <input type="checkbox" checked={cfg.rag} onChange={(e) => set('rag', e.target.checked)} />
            <span>启用检索增强</span>
          </label>
          <select className="zx-input" style={{ maxWidth: 180 }} value={cfg.embedProvider} onChange={(e) => selectProvider('embedProvider', e.target.value)}>
            {embProviders.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input className="zx-input" style={{ maxWidth: 260, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} placeholder="Embed Base URL" value={cfg.embedBaseUrl} onChange={(e) => set('embedBaseUrl', e.target.value)} />
          <select className="zx-input" style={{ maxWidth: 200, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            value={embedCustom ? '__custom__' : cfg.embedModel}
            onChange={(e) => {
              const v = e.target.value
              if (v === '__custom__') setEmbedCustom(true)
              else {
                setEmbedCustom(false)
                set('embedModel', v)
              }
            }}>
            <option value="">(选择模型)</option>
            {embedModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {cfg.embedModel && !embedModels.includes(cfg.embedModel) && <option value={cfg.embedModel}>{cfg.embedModel}(当前)</option>}
            <option value="__custom__">自定义…</option>
          </select>
          <button type="button" className="zx-btn zx-btn-sm" disabled={modelsBusy === 'embed'} title="按已保存的 baseUrl/key 拉取模型列表"
            onClick={() => void loadModels('embed', { provider: cfg.embedProvider, baseUrl: cfg.embedBaseUrl })}>
            {modelsBusy === 'embed' ? '…' : '↻'}
          </button>
          {embedCustom && (
            <input className="zx-input" style={{ maxWidth: 200, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} placeholder="手动输入 embed 模型" value={cfg.embedModel} onChange={(e) => set('embedModel', e.target.value)} />
          )}
          {modelsErr.embed && <span className="zx-msg err" style={{ fontSize: '0.66rem' }}>{modelsErr.embed}</span>}
          <label className="zx-muted zx-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.66rem' }} title="向量维度(模型决定,如 bge-m3=1024);未知模型请手填">
            维数
            <input className="zx-input" style={{ maxWidth: 80 }} type="number" value={cfg.embedDim} onChange={(e) => set('embedDim', num(e.target.value, 0))} />
          </label>
          <input className="zx-input" style={{ maxWidth: 260, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} type="password"
            placeholder={cfg.embedApiKey ? `已配置 ${cfg.embedApiKey}(留空不改)` : 'Embed API Key(本地 Ollama 可留空)'} value={embedKey} onChange={(e) => setEmbedKey(e.target.value)} autoComplete="off" />
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="zx-muted zx-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.66rem' }} title="每次检索注入的知识块数量(1–10)">
            topK
            <input className="zx-input" style={{ maxWidth: 80 }} type="number" min={1} max={10} value={cfg.topK} onChange={(e) => set('topK', num(e.target.value, 4))} />
          </label>
        </div>
      </div>

      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>灵魂蒸馏 <span>corpus → persona.md / faq.json + 知识块</span></h3>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
          <label className="zx-btn zx-btn-sm" style={{ cursor: 'pointer' }}>
            选择文件…
            <input
              type="file"
              multiple
              accept=".md,.txt,text/markdown,text/plain"
              style={{ display: 'none' }}
              disabled={!!dBusy}
              onChange={(e) => {
                setPendingFiles((pf) => [...pf, ...Array.from(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </label>
          {typeof window !== 'undefined' && 'showDirectoryPicker' in window ? (
            <button
              className="zx-btn zx-btn-sm"
              type="button"
              disabled={!!dBusy}
              onClick={async () => {
                try {
                  const picked = await pickDirectoryFiles()
                  setPendingFiles((pf) => [...pf, ...picked])
                } catch (e) {
                  if (!(e instanceof DOMException && e.name === 'AbortError')) notify('err', e instanceof Error ? e.message : '选择文件夹失败')
                }
              }}
            >
              选择文件夹…
            </button>
          ) : (
            <label className="zx-btn zx-btn-sm" style={{ cursor: 'pointer' }}>
              选择文件夹…
              <input
                type="file"
                multiple
                {...({ webkitdirectory: true } as React.InputHTMLAttributes<HTMLInputElement>)}
                style={{ display: 'none' }}
                disabled={!!dBusy}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []).filter((f) => /\.(md|txt)$/i.test(f.name))
                  setPendingFiles((pf) => [...pf, ...picked])
                  e.target.value = ''
                }}
              />
            </label>
          )}
          <button className="zx-btn zx-btn-sm zx-btn-primary" disabled={!!dBusy || !pendingFiles.length} onClick={() => void uploadCorpus()}>
            {dBusy === 'upload' ? '上传并蒸馏…' : `上传并蒸馏${pendingFiles.length ? `(${pendingFiles.length})` : ''}`}
          </button>
          {pendingFiles.length > 0 && (
            <span className="zx-mono" style={{ fontSize: '0.68rem', maxWidth: '100%', display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
              <span className="zx-muted">待上传:</span>
              {pendingFiles.slice(0, 8).map((f) => (
                <span key={f.webkitRelativePath || f.name} className="zx-stat" style={{ fontSize: '0.64rem', padding: '1px 6px' }} title={f.webkitRelativePath || f.name}>
                  {(f.webkitRelativePath || f.name).split('/').pop()}
                </span>
              ))}
              {pendingFiles.length > 8 && <span className="zx-muted">+{(pendingFiles.length - 8)}</span>}
              <button className="zx-btn zx-btn-sm zx-btn-ghost" style={{ padding: '0 0.3rem', minWidth: 0, marginLeft: '0.3rem' }}
                disabled={!!dBusy}
                title="清空待上传列表"
                onClick={() => setPendingFiles([])}
              >
                清空
              </button>
            </span>
          )}
          <span className="zx-muted zx-mono" style={{ fontSize: '0.68rem' }}>
            .md/.txt · 可选文件或整个文件夹 · 无大小限制 · 重名/类型不支持会上传失败
          </span>
        </div>
        {distill && (
          <>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', margin: '0 0 0.6rem' }}>
              <span className="zx-muted zx-mono" style={{ fontSize: '0.72rem' }}>
                persona:{distill.hasPersona ? '✓ 有' : '无'}
                {distill.personaAt ? ` (${distill.personaAt.slice(5, 16).replace('T', ' ')})` : ' (未生成)'} · FAQ {distill.faqCount} 条
                {distill.faqAt ? ` (${distill.faqAt.slice(5, 16).replace('T', ' ')})` : ''} · 知识块 {distill.chunkCount} 条 · corpus {distill.corpus.length} 个
              </span>
              {distill.corpus.length > 0 && (
                <input
                  className="zx-input"
                  style={{ maxWidth: 240, fontSize: '0.72rem', marginLeft: 'auto' }}
                  placeholder="筛选文件名…"
                  value={corpusFilter}
                  onChange={(e) => setCorpusFilter(e.target.value)}
                />
              )}
            </div>
            {distill.corpus.length > 0 && <CorpusFileList
              items={distill.corpus}
              filter={corpusFilter}
              dBusy={dBusy}
              kindOverrides={distill.kindOverrides}
              sanitized={distill.sanitized}
              sensitiveAllowed={distill.sensitiveAllowed}
              collapse={corpusCollapse}
              onToggleCollapse={(k) =>
                setCorpusCollapse((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))
              }
              onSetKind={setKind}
              onDelete={deleteCorpus}
              onAllow={setSensitiveAllow}
              onUnignore={unignoreCorpus}
              onIgnore={ignoreCorpus}
              onOpen={(rel) => void openViewer(rel)}
            />}
          </>
        )}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.6rem' }}>
          <button className="zx-btn zx-btn-sm zx-btn-primary" disabled={!!dBusy || anyRunning} onClick={() => void distillAction('process')}>
            {distillRunning ? `蒸馏中 ${distill?.progress?.done ?? 0}/${distill?.progress?.total ?? 0}` : dBusy === 'process' ? '启动中…' : '扫描并蒸馏'}
          </button>
          <label className="zx-check" title={anyRunning ? '有任务在跑,结束后再改' : ''}>
            <input type="checkbox" checked={force} disabled={anyRunning} onChange={(e) => setForce(e.target.checked)} />
            <span>全量重跑</span>
          </label>
          <button className="zx-btn zx-btn-sm" disabled={!!dBusy || anyRunning || !distill?.hasPersona} onClick={() => void distillAction('persona')}>
            {personaRunning ? '生成人格中…' : dBusy === 'persona' ? '启动中…' : '生成人格(persona+FAQ)'}
          </button>
          <button className="zx-btn zx-btn-sm zx-btn-ghost" disabled={!!dBusy || anyRunning} onClick={() => void distillAction('clear')}>
            {dBusy === 'clear' ? '清空中…' : '清空知识库'}
          </button>
          {anyRunning && (
            <button className="zx-btn zx-btn-sm zx-btn-ghost" disabled={!!dBusy} onClick={() => void cancelJob()}>
              取消
            </button>
          )}
        </div>
        {distill?.progress && (distill.progress.running || distill.progress.finishedAt) && (
          <div className="zx-muted zx-mono" style={{ fontSize: '0.7rem', marginTop: '0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: distill.progress.running ? 'var(--zx-accent, #4c8)' : undefined }}>
              {distill.progress.running
                ? `蒸馏中 ${distill.progress.done}/${distill.progress.total}`
                : distill.progress.cancelled
                  ? `上次蒸馏已取消 ${distill.progress.done}/${distill.progress.total}`
                  : `上次蒸馏 ${distill.progress.done}/${distill.progress.total}`}
              {distill.progress.force ? '(全量)' : '(增量)'}
            </span>
            <span>✓{distill.progress.ok} ⛔{distill.progress.ignored} ✕{distill.progress.error}</span>
            {distill.progress.running && distill.progress.current && <span>当前:{distill.progress.current}</span>}
            {!distill.progress.running && distill.progress.finishedAt && <span>于 {distill.progress.finishedAt.slice(11, 19)}</span>}
          </div>
        )}
        {distill?.persona && (distill.persona.running || distill.persona.finishedAt) && (
          <div className="zx-muted zx-mono" style={{ fontSize: '0.7rem', marginTop: '0.3rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: distill.persona.running ? 'var(--zx-accent, #4c8)' : distill.persona.ok ? 'var(--zx-ok, #2f9e44)' : 'var(--zx-danger, #e5484d)' }}>
              {distill.persona.running
                ? '人格生成中…'
                : distill.persona.cancelled
                  ? '人格生成已取消'
                  : distill.persona.ok
                    ? `人格生成成功 · FAQ ${distill.persona.faq} 条`
                    : '人格生成失败'}
            </span>
            {distill.persona.startedAt && <span>开始 {distill.persona.startedAt.slice(11, 19)}</span>}
            {!distill.persona.running && distill.persona.finishedAt && <span>结束 {distill.persona.finishedAt.slice(11, 19)}</span>}
            {distill.persona.error && <span style={{ color: 'var(--zx-danger, #e5484d)' }}>错误:{distill.persona.error.slice(0, 120)}</span>}
          </div>
        )}
<p className="zx-muted zx-mono" style={{ fontSize: '0.68rem', marginTop: '0.6rem', lineHeight: 1.6 }}>
        可在此直接上传 corpus 文件(.md/.txt,可选整个文件夹,上传后在<b>后台</b>自动「扫描并蒸馏」);也可自行放
        <span className="zx-accent"> docker/site-content/chatbot/corpus/</span>。蒸馏自动分类:
        人格类素材 → 生成 persona.md + faq.json;知识类 → 切块(500/75)入知识库。改文件后「全量重跑」或改 sha 再增量。
        蒸馏在<b>后台跑批</b>(多篇合并分类省 token、并发执行省时间),按钮下方实时显示 `done/total` 进度,可安全离开页面。
        「全量重跑」会重分类并重建全部知识块(耗时耗 token),默认不勾、勾选后有二次确认。
        蒸馏会自动<b>过滤垃圾内容</b>(近空 / 纯数字符号的碎屑)进入「已忽略」,留盘可恢复,「恢复入库」重新摄取;超短备忘仅在行内加⚠提示不自动跳过。
        上传/蒸馏会<b>自动检测并脱敏</b>敏感信息(身份证/银行卡/手机号/密钥/连接串/亲属·住址·出生语境等),
        命中显示「⚠ 已脱敏…」;示例写法等误报时点「按原文放行」。行内改类别/放行/忽略只重跑该文件,不再触发整库。
      </p>
      </div>

      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>对话日志 <span>近 14 天每日提问 · 最近会话</span></h3>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          {dayCounts.map((d) => (
            <span key={d.day} className="zx-stat" style={{ fontSize: '0.72rem', padding: '4px 8px' }}>
              {d.day.slice(5)}:{d.count}
            </span>
          ))}
        </div>
        {logs.length === 0 && !logsBusy && <div className="zx-c-empty">暂无对话</div>}
        {logs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {logs.slice(0, 20).map((l) => (
              <div key={l.id} className="zx-comment">
                <div className="zx-c-head">
                  <span className="zx-c-author">{l.role === 'user' ? '访客' : '分身'}</span>
                  <span className="zx-c-time">#{l.id} · {l.cid.slice(0, 8)} · {l.created_at}</span>
                  {l.role === 'assistant' && <span className="zx-c-time">in {l.in_tokens} / out {l.out_tokens}</span>}
                  <span className="zx-c-time" style={{ marginLeft: 'auto' }}>{l.model || l.provider}</span>
                </div>
                <div className="zx-c-body">{l.content.slice(0, 400)}{l.content.length > 400 ? '…' : ''}</div>
              </div>
            ))}
          </div>
        )}
        <button className="zx-btn zx-btn-sm zx-btn-ghost" style={{ marginTop: '0.6rem' }} onClick={() => void clearLogs()}>
          清空日志
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <button className="zx-btn zx-btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存配置'}
        </button>
        <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>
          保存后前台 Chatter 即时生效(会话上下文按访客 cid)
        </span>
      </div>
      {viewer && (
        <CorpusViewer
          rel={viewer.rel}
          name={viewer.name}
          state={viewState}
          text={viewText}
          onClose={() => setViewer(null)}
          onDelete={async (rel) => {
            await deleteCorpus(rel)
            setViewer(null)
          }}
        />
      )}
    </MantineBridge>
  )
}