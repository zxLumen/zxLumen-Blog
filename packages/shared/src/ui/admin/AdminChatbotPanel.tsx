'use client'

// 机器人后台面板:对话/provider 配置 + 检索(embedding)配置 + 灵魂蒸馏 + 对话日志。
import { useCallback, useEffect, useState } from 'react'
import { MantineBridge } from './mantine-bridge.js'
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
  status: string
  error: string
}

interface KbDoc {
  source: string
  kind: string
  status: string
  size: number
  error: string
  sha: string
}

interface DistillStatus {
  corpus: CorpusItem[]
  docs: KbDoc[]
  chunkCount: number
  hasPersona: boolean
  faqCount: number
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

const num = (s: string, fallback: number) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
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
  const [dBusy, setDBusy] = useState<'process' | 'persona' | 'clear' | ''>('')
  const [force, setForce] = useState(false)

  const [logs, setLogs] = useState<LogRow[]>([])
  const [dayCounts, setDayCounts] = useState<Array<{ day: string; count: number }>>([])
  const [logsBusy, setLogsBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/chatbot', { credentials: 'same-origin', cache: 'no-store' })
      if (!r.ok) throw new Error('加载失败')
      const d = (await r.json()) as Payload
      setCfg(d.config)
      setProviders(d.providers)
      setEmbProviders(d.embeddingProviders)
      setLastError(d.lastError)
    } catch {
      notify('err', '机器人配置加载失败')
    } finally {
      setLoading(false)
    }
  }, [notify])

  const loadDistill = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/chatbot/distill', { credentials: 'same-origin', cache: 'no-store' })
      if (r.ok) setDistill((await r.json()) as DistillStatus)
    } catch {
      /* 忽略 */
    }
  }, [])

  const loadLogs = useCallback(async () => {
    setLogsBusy(true)
    try {
      const r = await fetch('/api/admin/chatbot/logs?limit=30&days=14', {
        credentials: 'same-origin',
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
  }

  const save = async () => {
    if (!cfg) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { ...cfg }
      if (chatKey.trim()) body.chatApiKey = chatKey.trim()
      if (embedKey.trim()) body.embedApiKey = embedKey.trim()
      const r = await fetch('/api/admin/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
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
      notify('ok', '机器人配置已保存')
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const distillAction = async (action: 'process' | 'persona' | 'clear') => {
    setDBusy(action)
    try {
      const r = await fetch('/api/admin/chatbot/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, force: action === 'process' ? force : undefined }),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean; action?: string; items?: CorpusItem[] }
      if (!r.ok || !d.ok) throw new Error(d.error || '蒸馏失败')
      await loadDistill()
      notify('ok', d.action === 'persona' ? '人格已生成(persona.md + faq.json)' : d.action === 'clear' ? '知识库已清空' : `蒸馏完成 · ${d.items?.length ?? 0} 个文件`)
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '蒸馏失败')
    } finally {
      setDBusy('')
    }
  }

  const clearLogs = async () => {
    if (!confirm('清空全部对话日志?')) return
    const r = await fetch('/api/admin/chatbot/logs', { method: 'DELETE', credentials: 'same-origin' })
    if (r.ok) {
      setLogs([])
      notify('ok', '日志已清空')
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
          <input className="zx-input" style={{ maxWidth: 220, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} placeholder="模型(如 deepseek-chat)" value={cfg.chatModel} onChange={(e) => set('chatModel', e.target.value)} />
          <input className="zx-input" style={{ maxWidth: 90 }} type="number" step="0.1" min="0" max="2" placeholder="温度" value={cfg.temperature} onChange={(e) => set('temperature', num(e.target.value, 0.7))} />
          <input className="zx-input" style={{ maxWidth: 90 }} type="number" placeholder="max_tokens" value={cfg.maxTokens} onChange={(e) => set('maxTokens', num(e.target.value, 1024))} />
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="zx-input" type="password" style={{ maxWidth: 280, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            placeholder={cfg.chatApiKey ? `已配置 ${cfg.chatApiKey}(留空不改)` : '聊天 API Key'} value={chatKey} onChange={(e) => setChatKey(e.target.value)} autoComplete="off" />
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>回退环境变量 CHATBOT_API_KEY;Key 仅存服务器</span>
        </div>
        <textarea className="zx-input zx-textarea" style={{ marginTop: '0.6rem' }} rows={3} placeholder="开场问候语" value={cfg.greeting} onChange={(e) => set('greeting', e.target.value)} />
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
          <input className="zx-input" style={{ maxWidth: 200, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} placeholder="embed 模型" value={cfg.embedModel} onChange={(e) => set('embedModel', e.target.value)} />
          <input className="zx-input" style={{ maxWidth: 90 }} type="number" placeholder="维数" value={cfg.embedDim} onChange={(e) => set('embedDim', num(e.target.value, 0))} />
          <input className="zx-input" style={{ maxWidth: 260, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }} type="password"
            placeholder={cfg.embedApiKey ? `已配置 ${cfg.embedApiKey}(留空不改)` : 'Embed API Key(本地 Ollama 可留空)'} value={embedKey} onChange={(e) => setEmbedKey(e.target.value)} autoComplete="off" />
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="zx-muted zx-mono" style={{ fontSize: '0.66rem' }}>topK</span>
          <input className="zx-input" style={{ maxWidth: 80 }} type="number" placeholder="topK" value={cfg.topK} onChange={(e) => set('topK', num(e.target.value, 4))} />
        </div>
      </div>

      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>灵魂蒸馏 <span>corpus → persona.md / faq.json + 知识块</span></h3>
        {distill && (
          <>
            <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', margin: '0 0 0.6rem' }}>
              persona:{distill.hasPersona ? '✓ 有' : '无'} · FAQ {distill.faqCount} 条 · 知识块 {distill.chunkCount} 条 · corpus {distill.corpus.length} 个
            </p>
            {distill.corpus.length > 0 && (
              <table className="zx-table" style={{ fontSize: '0.72rem' }}>
                <thead>
                  <tr>
                    <th>文件</th>
                    <th>类别</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {distill.corpus.map((c) => (
                    <tr key={c.rel}>
                      <td className="zx-mono">{c.name}</td>
                      <td>{c.kind ?? '?'}{c.kind === null ? '(蒸馏后定)' : c.kind === 'persona' ? '人格' : '知识'}</td>
                      <td>
                        {c.status === 'processed' ? '✓' : c.status === 'error' ? <span className="zx-msg err">{c.error}</span> : '待处理'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.6rem' }}>
          <button className="zx-btn zx-btn-sm zx-btn-primary" disabled={!!dBusy} onClick={() => void distillAction('process')}>
            {dBusy === 'process' ? '蒸馏中…' : '扫描并蒸馏'}
          </button>
          <label className="zx-check">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            <span>全量重跑</span>
          </label>
          <button className="zx-btn zx-btn-sm" disabled={!!dBusy || !distill?.hasPersona} onClick={() => void distillAction('persona')}>
            {dBusy === 'persona' ? '生成中…' : '生成人格(persona+FAQ)'}
          </button>
          <button className="zx-btn zx-btn-sm zx-btn-ghost" disabled={!!dBusy} onClick={() => void distillAction('clear')}>
            {dBusy === 'clear' ? '清空中…' : '清空知识库'}
          </button>
        </div>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.68rem', marginTop: '0.6rem', lineHeight: 1.6 }}>
          corpus 文件放 <span className="zx-accent">docker/site-content/chatbot/corpus/</span>(.md/.txt);蒸馏时自动分类:
          人格类素材 → 生成 persona.md + faq.json;知识类 → 切块(500/75)入知识库。改文件后「全量重跑」或改 sha 再增量。
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
    </MantineBridge>
  )
}