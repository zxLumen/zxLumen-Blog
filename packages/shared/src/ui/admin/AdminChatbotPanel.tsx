'use client'

// 机器人后台面板:对话/provider 配置 + 检索(embedding)配置 + 灵魂蒸馏 + 对话日志。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MantineBridge } from './mantine-bridge.js'
import { adminFetch } from './admin-fetch.js'
import { useBarTooltip } from '../BarTooltip.js'
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
  session_id: string
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

/** 一次对话(按 session_id 归并);接口把该会话的消息内嵌在 messages 里 */
interface ChatSession {
  session_id: string
  cid: string
  day: string
  started_at: string
  last_at: string
  turns: number
  msg_count: number
  in_tokens: number
  out_tokens: number
  latency_ms: number
  models: string
  first_question: string
  messages: LogRow[]
}

interface VisitorAlias {
  cid: string
  alias: string
}

/** 正文截断长度;超过就显示「展开」 */
const LOG_CLAMP = 400
/** 日统计柱状图的窗口天数 */
const LOG_DAYS = 14
/** 单个会话最多渲染多少条消息(超出的折叠,避免一条几十轮的长会话把页面撑爆) */
const LOG_MAX_MSGS = 100

/** 外链新窗口打开(同前台 ChatWidget) */
const mdComponents: Components = {
  a({ node, ...props }) {
    void node
    return <a {...props} target="_blank" rel="noreferrer noopener" />
  },
}

/** `2026-10-01 11:28:05` → `10-01 11:28`;跨天时首条补上日期 */
const fmtWhen = (ts: string): string => (ts.length >= 16 ? `${ts.slice(5, 10)} ${ts.slice(11, 16)}` : ts)

/** 停留时长:毫秒 → 「4.2s」/「1分12秒」 */
function fmtDur(ms: number): string {
  if (!ms || ms < 0) return ''
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒`
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

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [dayCounts, setDayCounts] = useState<Array<{ day: string; count: number }>>([])
  const [logsBusy, setLogsBusy] = useState(false)
  const [logQ, setLogQ] = useState('')
  const [logDay, setLogDay] = useState('')
  /** 访客筛选(空 = 不限);选项来自 visitor_aliases,与日志接口解耦 */
  const [logCid, setLogCid] = useState('')
  const [aliases, setAliases] = useState<Record<string, string>>({})
  /** 展开的会话(默认只展开最新一条);展开的正文(超过 LOG_CLAMP 的) */
  const [openSids, setOpenSids] = useState<string[]>([])
  const [openMsgs, setOpenMsgs] = useState<number[]>([])
  const barTip = useBarTooltip()
  const PAGE = 10
  /**
   * 「加载更多」的下一页偏移。用 ref 而不是 `sessions.length`:
   * 若让 loadLogs 依赖 sessions.length,加载更多会改变它的身份 → 挂载 effect 跟着
   * 重跑 → 又把第一页拉回来覆盖掉追加的结果,表现为「点了没反应」。
   * 改成 ref 后 loadLogs 只随筛选变化,加载更多不会触发重载。
   */
  const nextOffset = useRef(0)

  /** 访客下拉选项:昵称优先,没有昵称的退回 cid 前 8 位 */
  const cidOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const s of sessions) if (s.cid) seen.add(s.cid)
    return [...seen].map((cid) => ({ cid, name: aliases[cid] || `${cid.slice(0, 8)}…` }))
  }, [sessions, aliases])

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

const [logQDebounced, setLogQDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setLogQDebounced(logQ.trim()), 350)
    return () => clearTimeout(t)
  }, [logQ])

  /**
   * 取对话日志。`append` 为 true 时是「加载更多」——把本页会话接在已有列表后面。
   * 搜索用 `logQDebounced` 而不是 logQ 本体,免得每敲一个字打一次接口。
   */
  const loadLogs = useCallback(
    async (opts: { append?: boolean } = {}) => {
      const offset = opts.append ? nextOffset.current : 0
      setLogsBusy(true)
      try {
        const q = new URLSearchParams({ days: String(LOG_DAYS), limit: String(PAGE), offset: String(offset) })
        if (logQDebounced) q.set('q', logQDebounced)
        if (logDay) q.set('day', logDay)
        if (logCid) q.set('cid', logCid)
        const [r, ar] = await Promise.all([
          adminFetch(`/api/admin/chatbot/logs?${q.toString()}`, { cache: 'no-store' }),
          // 访客昵称:日志接口不带,单独取一次(失败不影响主列表;翻页不用重复取)
          opts.append
            ? Promise.resolve(null)
            : adminFetch('/api/admin/visitor-alias', { cache: 'no-store' }).catch(() => null),
        ])
        if (!r.ok) return
        const d = (await r.json()) as {
          sessions?: ChatSession[]
          total?: number
          hasMore?: boolean
          dayCounts?: Array<{ day: string; count: number }>
        }
        const got = d.sessions ?? []
        nextOffset.current = offset + got.length
        setSessions((prev) => (opts.append ? [...prev, ...got] : got))
        setLogTotal(d.total ?? 0)
        setHasMore(!!d.hasMore)
        if (d.dayCounts) setDayCounts(d.dayCounts)
        // 默认全部折叠:一屏能扫完列表,想看哪次对话再点开
        if (!opts.append) setOpenSids([])
        if (ar?.ok) {
          const ad = (await ar.json().catch(() => ({ aliases: [] }))) as { aliases?: VisitorAlias[] }
          const map: Record<string, string> = {}
          for (const a of ad.aliases ?? []) if (a.alias) map[a.cid] = a.alias
          setAliases(map)
        }
      } catch {
        /* 忽略 */
      } finally {
        setLogsBusy(false)
      }
    },
    [logQDebounced, logDay, logCid],
  )

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

  /** 删一次对话(卡片右上角);成功后从本地列表摘掉,不用整页重拉 */
const deleteSession = async (s: ChatSession) => {
    if (!confirm(`删除 ${fmtWhen(s.started_at)} 这次对话?\n共 ${s.msg_count} 条消息(访客 ${aliases[s.cid] || s.cid.slice(0, 8)}),删了不可恢复。`))
      return
    const r = await adminFetch('/api/admin/chatbot/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-session', session_id: s.session_id }),
    })
    const d = (await r.json().catch(() => ({}))) as { error?: string; deleted?: number }
    if (!r.ok) {
      notify('err', d.error || '删除失败')
      return
    }
    setSessions((prev) => prev.filter((x) => x.session_id !== s.session_id))
    setLogTotal((n) => Math.max(0, n - 1))
    // 柱状图按「提问条数」统计,删掉这次对话要把当天的提问数一起减掉
    setDayCounts((prev) =>
      prev.map((d) => (d.day === s.day ? { ...d, count: Math.max(0, d.count - s.turns) } : d)),
    )
    setOpenSids((prev) => prev.filter((x) => x !== s.session_id))
    notify('ok', `已删除该次对话(${d.deleted ?? 0} 条)`)
  }

  /** 只保留最近 N 天;先问一次删多少,再动手 */
const pruneLogs = async (keepDays: number) => {
    if (!confirm(`只保留最近 ${keepDays} 天的对话日志?\n更早的记录会被永久删除,不可恢复。`)) return
    const r = await adminFetch('/api/admin/chatbot/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prune', keep_days: keepDays }),
    })
    const d = (await r.json().catch(() => ({}))) as { error?: string; deleted?: number }
    if (!r.ok) {
      notify('err', d.error || '清理失败')
      return
    }
    notify('ok', `已清理 ${d.deleted ?? 0} 条旧日志`)
    void loadLogs()
  }

  /** 全清:先不带 confirm 探一次待删条数,把影响范围摆出来再确认 */
const clearLogs = async () => {
    const probe = await adminFetch('/api/admin/chatbot/logs', { method: 'DELETE' })
    const pd = (await probe.json().catch(() => ({}))) as { total?: number }
    const n = pd.total ?? 0
    if (!n) {
      notify('ok', '没有可清理的对话日志')
      return
    }
    if (!confirm(`清空全部对话日志?\n共 ${n} 次对话,永久删除、不可恢复。\n如果只是想清理旧记录,用「只保留最近 N 天」更合适。`))
      return
    const r = await adminFetch('/api/admin/chatbot/logs?confirm=1', { method: 'DELETE' })
    if (r.ok) {
      setSessions([])
      setLogTotal(0)
      setHasMore(false)
      setOpenSids([])
      // 柱状图也一并归零,否则会留着清空前的计数误导人
      setDayCounts((prev) => prev.map((d) => ({ ...d, count: 0 })))
      nextOffset.current = 0
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
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>聊天 API Key 已统一在「AI 密钥」页管理(取「默认对话」密钥;回退环境变量 CHATBOT_API_KEY)</span>
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
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>Embed Key 见「AI 密钥」页(取「默认向量」密钥)</span>
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
        <h3>
          对话日志{' '}
          <span>
            {logTotal} 次对话 · 近 {dayCounts.length} 天共 {dayCounts.reduce((a, d) => a + d.count, 0)} 次提问
          </span>
        </h3>

        {/* 日统计:点柱子即筛选当天,再点取消。以前是一排 "09-19:0" 的 chip,
            既看不出高低也点不动。 */}
        <div className="zx-chatlog-chart" onMouseMove={barTip.onMouseMove} onMouseLeave={barTip.onMouseLeave}>
          {dayCounts.map((d) => {
            const max = Math.max(1, ...dayCounts.map((x) => x.count))
            return (
              <div
                key={d.day}
                className={`zx-bar${d.count === 0 ? ' is-zero' : ''}${logDay === d.day ? ' is-sel' : ''}`}
                data-label={`${d.day} · ${d.count} 次提问${logDay === d.day ? ' ·(已筛选,点击取消)' : ' ·(点击只看这天)'}`}
                style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
                onClick={() => setLogDay((cur) => (cur === d.day ? '' : d.day))}
              />
            )
          })}
        </div>
        {barTip.node}

        <div className="zx-chatlog-toolbar" style={{ marginTop: '0.5rem' }}>
          <input
            type="search"
            placeholder="搜索问题 / 回答 / 会话 id"
            value={logQ}
            onChange={(e) => setLogQ(e.target.value)}
          />
          {logDay && (
            <button className="zx-btn zx-btn-sm zx-btn-ghost" onClick={() => setLogDay('')}>
              取消日期筛选({logDay.slice(5)})
            </button>
          )}
          <select value={logCid} onChange={(e) => setLogCid(e.target.value)} title="只看某个访客的对话">
            <option value="">全部访客</option>
            {cidOptions.map((o) => (
              <option key={o.cid} value={o.cid}>
                {o.name}
              </option>
            ))}
          </select>
          {logCid && (
            <button className="zx-btn zx-btn-sm zx-btn-ghost" onClick={() => setLogCid('')}>
              取消访客筛选
            </button>
          )}
          {(logQ || logDay || logCid) && (
            <span className="zx-muted zx-mono" style={{ fontSize: '0.68rem' }}>
              命中 {logTotal} 次对话
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
            <select
              value=""
              title="只保留最近 N 天的日志"
              onChange={(e) => {
                if (e.target.value) void pruneLogs(Number(e.target.value))
                e.target.value = ''
              }}
            >
              <option value="">只保留最近 N 天…</option>
              <option value="7">保留 7 天</option>
              <option value="30">保留 30 天</option>
              <option value="90">保留 90 天</option>
            </select>
            <button className="zx-btn zx-btn-sm zx-btn-ghost" onClick={() => void clearLogs()}>
              清空全部
            </button>
          </span>
        </div>

        {sessions.length === 0 && !logsBusy && (
          <div className="zx-c-empty">{logQ || logDay || logCid ? '没有匹配的对话' : '暂无对话'}</div>
        )}

        {sessions.map((s) => {
          const open = openSids.includes(s.session_id)
          const who = aliases[s.cid] || s.cid.slice(0, 8) || '(未知访客)'
          const token = s.in_tokens + s.out_tokens
          // 超长会话只渲染末尾一段,免得几十轮把页面撑到几千像素
          const msgs = s.messages ?? []
          const shown = msgs.length > LOG_MAX_MSGS ? msgs.slice(-LOG_MAX_MSGS) : msgs
          return (
            <div key={s.session_id} className="zx-chatsess">
              <button
                className="zx-chatsess-head"
                onClick={() =>
                  setOpenSids((prev) =>
                    prev.includes(s.session_id)
                      ? prev.filter((x) => x !== s.session_id)
                      : [...prev, s.session_id],
                  )
                }
              >
                <span className="zx-chatsess-caret">{open ? '\u25be' : '\u25b8'}</span>
                <span className="zx-chatsess-when">{fmtWhen(s.started_at)}</span>
                <span className="zx-chatsess-who">{who}</span>
                <span className="zx-chatsess-meta">
                  {s.turns} 轮 · {s.msg_count} 条
                  {s.models ? ` · ${s.models}` : ''}
                  {token ? ` · in ${s.in_tokens}/out ${s.out_tokens}` : ''}
                  {s.latency_ms ? ` · ${fmtDur(s.latency_ms)}` : ''}
                </span>
                {!open && <span className="zx-chatsess-sum">首问「{s.first_question}」</span>}
              </button>
              {open && shown.length < msgs.length && (
                <div className="zx-chatsess-note">
                  共 {msgs.length} 条,只显示最近 {shown.length} 条(统计口径仍按全部 {s.msg_count} 条)
                </div>
              )}
              {open && (
                <div className="zx-chatsess-body">
                  {shown.map((l) => {
                    const long = l.content.length > LOG_CLAMP
                    const expanded = openMsgs.includes(l.id)
                    const isUser = l.role === 'user'
                    return (
                      <div
                        key={l.id}
                        className={`zx-chatsess-msg${isUser ? '' : ' is-assistant'}${!isUser && /^\[模型出错了\]/.test(l.content) ? ' is-error' : ''}`}
                      >
                        <div className="zx-chatsess-role">
                          {isUser ? '访客' : '分身'} · {fmtWhen(l.created_at)}
                          {!isUser && l.model ? ` · ${l.model}` : ''}
                          {!isUser && l.latency_ms ? ` · ${fmtDur(l.latency_ms)}` : ''}
                          {!isUser && (l.in_tokens || l.out_tokens) ? ` · in ${l.in_tokens}/out ${l.out_tokens}` : ''}
                        </div>
                        {isUser ? (
                          <div className="zx-chatsess-text">{l.content}</div>
                        ) : (
                          <>
                            {long && !expanded ? (
                              <>
                                <div className="zx-chatsess-text zxchat-md">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                    {l.content.slice(0, LOG_CLAMP)}
                                  </ReactMarkdown>
                                </div>
                                <button
                                  className="zx-chatsess-more"
                                  onClick={() => setOpenMsgs((prev) => [...prev, l.id])}
                                >
                                  展开全文({l.content.length} 字)
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="zx-chatsess-text zxchat-md">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                    {l.content}
                                  </ReactMarkdown>
                                </div>
                                {long && (
                                  <button
                                    className="zx-chatsess-more"
                                    onClick={() => setOpenMsgs((prev) => prev.filter((x) => x !== l.id))}
                                  >
                                    收起
                                  </button>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="zx-chatsess-del" onClick={() => void deleteSession(s)}>
                      删本次对话
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <div className="zx-chatlog-foot" style={{ marginTop: '0.6rem' }}>
          <span>
            已显示 {sessions.length} / {logTotal} 次对话
          </span>
          {hasMore && (
            <button className="zx-btn zx-btn-sm zx-btn-ghost" disabled={logsBusy} onClick={() => void loadLogs({ append: true })}>
              {logsBusy ? '加载中…' : '加载更多'}
            </button>
          )}
        </div>
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