'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchivedCommentRow, CommentRow, EventType, PagedComments, StatsResult, VisitorDetail } from '../schema.js'
import { fmtDateTime, fmtInt } from '../format.js'
import { PROJECTS } from '../content.js'
import { Pagination } from './Pagination.js'
import { AdminProjectsPanel } from './admin/AdminProjectsPanel.js'
import { useFeature } from './theme-context.js'

async function loadPageData(page: number, pageSize: number): Promise<PagedComments> {
  const res = await fetch(`/api/admin/comments?page=${page}&pageSize=${pageSize}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (res.status === 401) throw new Error('unauthorized')
  if (!res.ok) throw new Error(`加载失败 (${res.status})`)
  return (await res.json()) as PagedComments
}

const EVENT_LABEL: Record<EventType, string> = {
  visit: '访问',
  project_click: '项目点击',
  resume_download: '简历下载',
}

function targetLabel(t: string) {
  return PROJECTS.find((p) => p.id === t)?.name ?? t
}

/** 访客明细行:点击展开该访客的操作记录 */
function VisitorDetailRow({
  v,
  open,
  onToggle,
}: {
  v: VisitorDetail
  open: boolean
  onToggle: () => void
}) {
  const proj = Object.entries(v.projectClicks)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${targetLabel(t)}×${n}`)
    .join(' ')
  const m = (sec: number) => {
    if (sec >= 60) return `${Math.floor(sec / 60)}分${sec % 60 ? ` ${sec % 60}s` : ''}`
    return `${sec}s`
  }
  return (
    <>
      <tr className={open ? 'is-open' : ''} onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td>
          <div>
            {v.nickname || `访客 ${v.cid.slice(0, 8)}`}
            {v.nickname ? (
              <span className="zx-muted" style={{ fontSize: '0.7rem' }}>
                {' '}
                · {v.cid.slice(0, 8)}
              </span>
            ) : null}
          </div>
          <div className="zx-mono zx-muted" style={{ fontSize: '0.65rem' }}>
            {v.cid}
          </div>
        </td>
        <td className="num">{fmtInt(v.visits)}</td>
        <td className="num">{fmtInt(v.commentCount)}</td>
        <td className="num">{fmtInt(v.resumeDownloads)}</td>
        <td>
          {proj ? <span className="zx-mono zx-muted zx-proj-chips">{proj}</span> : <span className="zx-muted">—</span>}
        </td>
        <td className="zx-mono zx-muted">{v.lastSeen}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="zx-visitor-detail">
            <div className="zx-visitor-meta zx-mono zx-muted">
              <span>首访 {v.firstSeen}</span>
              <span>{v.returning ? '回头客' : '新客'}</span>
              <span>
                会话 {v.sessions} 次 · 平均 {v.avgSessionSec ? m(v.avgSessionSec) : '—'}
              </span>
              <span>{v.device}</span>
              <span>来源 {v.referrer || '直接打开'}</span>
            </div>
            {proj && (
              <div className="zx-visitor-line">
                项目点击:{' '}
                {Object.entries(v.projectClicks)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => `${targetLabel(t)} ×${n}`)
                  .join('、')}
              </div>
            )}
            {v.recent.length > 0 && (
              <div className="zx-visitor-events zx-mono zx-muted">
                {v.recent.map((e, i) => (
                  <div key={i}>
                    {e.ts} · {EVENT_LABEL[e.type]}
                    {e.target ? ` · ${targetLabel(e.target)}` : ''}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export function AdminPanel() {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [comments, setComments] = useState<CommentRow[]>([])
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [nick, setNick] = useState('')
  const [nickBusy, setNickBusy] = useState(false)

  const [cEmail, setCEmail] = useState('')
  const [cWechat, setCWechat] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [contactBusy, setContactBusy] = useState(false)
  const [qrUrl, setQrUrl] = useState('/wechat.png')
  const [qrBusy, setQrBusy] = useState(false)

  interface DsStatus {
    configured?: boolean
    exp?: number | null
    expired?: boolean | null
    lastSync?: string | null
    syncKey?: string
    lastError?: string | null
    lastData?: { at?: number; count?: number } | null
  }
  const [ds, setDs] = useState<DsStatus | null>(null)
  const [dsToken, setDsToken] = useState('')
  const [dsBusy, setDsBusy] = useState(false)

  interface OcStatus {
    configured?: boolean
    consoleUrl?: string
    lastError?: string | null
    lastData?: { at?: number; count?: number; since?: string } | null
  }
  const [oc, setOc] = useState<OcStatus | null>(null)
  const [ocUrl, setOcUrl] = useState('')
  const [ocKey, setOcKey] = useState('')
  const [ocBusy, setOcBusy] = useState(false)
  interface ZhipuStatus {
    configured?: boolean
    baseUrl?: string
    lastError?: string | null
    lastData?: { at?: number; count?: number } | null
  }
  const [zp, setZp] = useState<ZhipuStatus | null>(null)
  const [zpUrl, setZpUrl] = useState('')
  const [zpKey, setZpKey] = useState('')
  const [zpBusy, setZpBusy] = useState(false)
  type TabKey = 'comments' | 'archive' | 'profile' | 'token' | 'stats' | 'projects'
  const validTab = (t: unknown): t is TabKey =>
    t === 'comments' || t === 'archive' || t === 'profile' || t === 'token' || t === 'stats' || t === 'projects'
  // 刷新/新标签页都停留在上次 Tab(localStorage;SSR 首帧不渲染 tabs,无 hydration 冲突)
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'comments'
    try {
      const t = window.localStorage.getItem('zx-admin-tab')
      return validTab(t) ? t : 'comments'
    } catch {
      return 'comments'
    }
  })
  // 功能门控:按 LIVE_FEATURES 白名单放行(测试模式恒开)
  const showTabs = useFeature('admin-tabs')
  const showOc = useFeature('usage-opencode')
  const showZhipu = useFeature('usage-zhipu')

  const [archived, setArchived] = useState<ArchivedCommentRow[]>([])
  const [archTotal, setArchTotal] = useState(0)
  const [archPage, setArchPage] = useState(1)
  const [archPageSize, setArchPageSize] = useState(20)
  const [archTotalPages, setArchTotalPages] = useState(1)
  const [archLoading, setArchLoading] = useState(false)
  const [archBusy, setArchBusy] = useState(false)

  const [stats, setStats] = useState<StatsResult | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statVisitor, setStatVisitor] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await fetch('/api/admin/stats', { credentials: 'same-origin', cache: 'no-store' })
      if (res.ok) setStats((await res.json()) as StatsResult)
    } catch {
      /* ignore */
    } finally {
      setStatsLoading(false)
    }
  }, [])

  const loadArchive = useCallback(async (p: number, size: number) => {
    setArchLoading(true)
    try {
      const res = await fetch(`/api/admin/archive?page=${p}&pageSize=${size}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('加载归档失败')
      const d = (await res.json()) as {
        rows: ArchivedCommentRow[]
        total: number
        page: number
        pageSize: number
        totalPages: number
      }
      setArchived(d.rows ?? [])
      setArchTotal(d.total ?? 0)
      setArchPage(d.page ?? 1)
      setArchPageSize(d.pageSize ?? size)
      setArchTotalPages(d.totalPages ?? 1)
    } catch {
      setArchived([])
    } finally {
      setArchLoading(false)
    }
  }, [])

  async function onArchAction(id: number, action: 'restore' | 'purge') {
    if (action === 'purge' && !confirm(`彻底删除归档留言 #${id}?此操作不可恢复`)) return
    setArchBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id, action }),
      })
      if (!res.ok) throw new Error('操作失败')
      await loadArchive(archPage, archPageSize)
      setMsg({
        kind: 'ok',
        text: action === 'restore' ? `已恢复 #${id}` : `已彻底删除 #${id}`,
      })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '操作失败' })
    } finally {
      setArchBusy(false)
    }
  }

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const [total, setTotal] = useState(0)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)

  const loadPage = useCallback(async (p: number, size: number) => {
    setLoading(true)
    try {
      const d = await loadPageData(p, size)
      setComments(d.rows ?? [])
      setTotal(d.total ?? 0)
      setListPage(d.page ?? 1)
      setPageSize(d.pageSize ?? size)
      setTotalPages(d.totalPages ?? 1)
      setAuthed(true)
    } catch {
      setAuthed(false)
    } finally {
      setLoading(false)
      setReady(true)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    const sres = await fetch('/api/admin/settings', { credentials: 'same-origin' })
    if (sres.ok) {
      const s = (await sres.json()) as {
        nick?: string
        contacts?: { email?: string; wechat?: string; phone?: string }
      }
      setNick(s.nick ?? '')
      setCEmail(s.contacts?.email ?? '')
      setCWechat(s.contacts?.wechat ?? '')
      setCPhone(s.contacts?.phone ?? '')
    }
    const qres = await fetch('/api/admin/wechat-qr', { credentials: 'same-origin' })
    if (qres.ok) {
      const q = (await qres.json()) as { hasQr?: boolean; ver?: string | null }
      setQrUrl(q.hasQr ? `/api/contact/wechat-qr?v=${q.ver}` : '/wechat.png')
    }
    const dres = await fetch('/api/admin/deepseek', { credentials: 'same-origin' })
    if (dres.ok) setDs((await dres.json()) as DsStatus)
    if (showOc) {
      const ores = await fetch('/api/admin/opencode', { credentials: 'same-origin' })
      if (ores.ok) {
        const o = (await ores.json()) as OcStatus
        setOc(o)
        if (o.consoleUrl && o.consoleUrl !== 'https://opencode.ai/console') setOcUrl(o.consoleUrl)
      }
    }
    if (showZhipu) {
      const zres = await fetch('/api/admin/zhipu', { credentials: 'same-origin' })
      if (zres.ok) {
        const z = (await zres.json()) as ZhipuStatus
        setZp(z)
        if (z.baseUrl && z.baseUrl !== 'https://open.bigmodel.cn') setZpUrl(z.baseUrl)
      }
    }
  }, [showOc, showZhipu])

  async function loadDeepseek() {
    const res = await fetch('/api/admin/deepseek', { credentials: 'same-origin' })
    if (res.ok) setDs((await res.json()) as DsStatus)
  }

  async function loadOpenCode() {
    const res = await fetch('/api/admin/opencode', { credentials: 'same-origin' })
    if (res.ok) {
      const o = (await res.json()) as OcStatus
      setOc(o)
      if (o.consoleUrl && o.consoleUrl !== 'https://opencode.ai/console') setOcUrl(o.consoleUrl)
    }
  }

  async function ocAction(action: 'save' | 'refresh' | 'clear', key?: string, url?: string) {
    if (action === 'refresh' && !oc?.configured) {
      setMsg({ kind: 'err', text: '未配置服务账号 Key:请先粘贴 oc_sk_… Key 保存后再验证' })
      return
    }
    setOcBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/opencode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, key, consoleUrl: url }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string; rows?: number }
      if (!res.ok) throw new Error(d.error || '操作失败')
      await loadOpenCode()
      setOcKey('')
      setMsg({
        kind: 'ok',
        text:
          action === 'refresh'
            ? `已从官方 Console 拉取 ${d.rows ?? 0} 行(校验通过)`
            : action === 'save'
              ? 'Key 已保存'
              : '已清除',
      })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '操作失败' })
    } finally {
      setOcBusy(false)
    }
  }

  async function loadZhipu() {
    const res = await fetch('/api/admin/zhipu', { credentials: 'same-origin' })
    if (res.ok) {
      const z = (await res.json()) as ZhipuStatus
      setZp(z)
      if (z.baseUrl && z.baseUrl !== 'https://open.bigmodel.cn') setZpUrl(z.baseUrl)
    }
  }

  async function zpAction(action: 'save' | 'refresh' | 'clear', key?: string, url?: string) {
    if (action === 'refresh' && !zp?.configured) {
      setMsg({ kind: 'err', text: '未配置智谱 API Key:请先粘贴保存后再验证' })
      return
    }
    setZpBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/zhipu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, key, baseUrl: url }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string; rows?: number }
      if (!res.ok) throw new Error(d.error || '操作失败')
      await loadZhipu()
      setZpKey('')
      setMsg({
        kind: 'ok',
        text:
          action === 'refresh'
            ? `已从智谱拉取 ${d.rows ?? 0} 个模型(校验通过)`
            : action === 'save'
              ? 'Key 已保存'
              : '已清除',
      })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '操作失败' })
    } finally {
      setZpBusy(false)
    }
  }

  async function dsAction(action: 'save' | 'refresh' | 'rotate' | 'clear', token?: string) {
    if (action === 'refresh' && !ds?.configured) {
      setMsg({ kind: 'err', text: '未配置令牌:请先通过书签/控制台命令同步 userToken 或粘贴保存' })
      return
    }
    setDsBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/deepseek', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, token }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string; rows?: number }
      if (!res.ok) throw new Error(d.error || '操作失败')
      if (action === 'save') setDsToken('')
      await loadDeepseek()
      setMsg({ kind: 'ok', text: action === 'refresh' ? `已刷新 · 拉取 ${d.rows ?? 0} 行(令牌有效)` : '操作成功' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '操作失败' })
    } finally {
      setDsBusy(false)
    }
  }

  function dsScript() {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const key = ds?.syncKey ?? ''
    return `(() => { const banner = (m) => { try { alert(m) } catch {}; const el = document.createElement('div'); el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;padding:12px 16px;background:#0b0f14;color:#e6edf3;border:1px solid #30363d;border-radius:8px;font:12px/1.5 monospace;max-width:420px;box-shadow:0 8px 24px rgba(0,0,0,.4)'; el.textContent = m; document.body.appendChild(el); setTimeout(() => el.remove(), 6000) }; (async () => { try { const raw = localStorage.getItem('userToken'); if (!raw) { banner('未找到 userToken:需先登录 platform.deepseek.com/usage 再执行'); return } let t; try { const j = JSON.parse(raw); t = (j && typeof j === 'object' && 'value' in j) ? j.value : j } catch { t = raw } if (!t || typeof t !== 'string') { banner('userToken 结构无法识别,请手动复制(见下方指引)'); return } if (t.startsWith('sk-')) { banner('拿到的是 API Key(sk-),需要一个带 .xxx 的网页登录令牌(userToken)'); return } const res = await fetch('${origin}/api/deepseek/token', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Sync-Key': '${key}' }, body: JSON.stringify({ token: t }) }); const detail = await res.json().catch(() => null); banner(res.ok ? '✅ 已同步 DeepSeek 令牌到主页' : ('❌ 同步失败 ' + res.status + ((detail && detail.error) ? ' · ' + detail.error : ''))) } catch (e) { banner('同步失败: ' + e) } })() })()`
  }

  function dsTokenScript() {
    return `(() => { let t; try { const j = JSON.parse(localStorage.getItem('userToken') || ''); t = (j && typeof j === 'object' && 'value' in j) ? j.value : j } catch { t = localStorage.getItem('userToken') } if (typeof t === 'string') t = t.trim(); if (!t) { alert('未找到 userToken,请先登录 platform.deepseek.com/usage'); return } if (t.startsWith('sk-')) { alert('这是 API Key(sk-),请用网页登录令牌 userToken'); return } (navigator.clipboard ? navigator.clipboard.writeText(t).then(() => alert('✅ 已复制 userToken,回 admin 粘贴保存')).catch(() => { prompt('自动复制失败,请手动全选复制:', t) }) : prompt('自动复制失败,请手动全选复制:', t)) })()`
  }

  async function copyText(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text)
      setMsg({ kind: 'ok', text: okMsg })
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        setMsg(ok ? { kind: 'ok', text: okMsg } : { kind: 'err', text: '复制失败,请手动复制' })
      } catch {
        setMsg({ kind: 'err', text: '复制失败,请手动复制' })
      }
    }
  }

  const dsBookmarkRef = useRef<HTMLAnchorElement>(null)
  const bookmarkHref = `javascript:${dsScript()}`

  useEffect(() => {
    if (dsBookmarkRef.current) dsBookmarkRef.current.href = bookmarkHref
  }, [bookmarkHref])

  async function uploadQr(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setMsg({ kind: 'err', text: '仅支持 PNG/JPEG/WebP' })
      return
    }
    if (file.size > 800 * 1024) {
      setMsg({ kind: 'err', text: '图片需 ≤ 800KB' })
      return
    }
    setQrBusy(true)
    setMsg(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('读取文件失败'))
        r.readAsDataURL(file)
      })
      const res = await fetch('/api/admin/wechat-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ dataUrl }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string; url?: string }
      if (!res.ok) throw new Error(d.error || '上传失败')
      setQrUrl(`${d.url}&t=${Date.now()}`)
      setMsg({ kind: 'ok', text: '二维码已更新,前台即时生效' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '上传失败' })
    } finally {
      setQrBusy(false)
    }
  }

  async function saveNick() {
    setNickBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ nick }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(d.error || '保存失败')
      setMsg({ kind: 'ok', text: '站长昵称已保存,留言将自动使用' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setNickBusy(false)
    }
  }

  async function saveContacts() {
    setContactBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ contacts: { email: cEmail, wechat: cWechat, phone: cPhone } }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(d.error || '保存失败')
      setMsg({ kind: 'ok', text: '联系方式已保存(前台立即生效)' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setContactBusy(false)
    }
  }

  useEffect(() => {
    void (async () => {
      await loadPage(1, 5)
      await loadSettings()
    })()
  }, [loadPage, loadSettings])

  useEffect(() => {
    try {
      window.localStorage.setItem('zx-admin-tab', tab)
    } catch {
      /* 忽略存储不可用 */
    }
  }, [tab])

  useEffect(() => {
    if (tab === 'archive') void loadArchive(archPage, archPageSize)
    if (tab === 'stats') void loadStats()
  }, [tab, loadArchive, archPage, archPageSize, loadStats])

  async function savePassword() {
    if (newPw !== newPw2) return setMsg({ kind: 'err', text: '两次输入的新密码不一致' })
    if (newPw.length < 4) return setMsg({ kind: 'err', text: '新密码至少 4 位' })
    setPwBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ current: curPw, next: newPw }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(d.error || '修改失败')
      setCurPw('')
      setNewPw('')
      setNewPw2('')
      setMsg({ kind: 'ok', text: '密码已更新(存于数据库,优先于环境变量)' })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '修改失败' })
    } finally {
      setPwBusy(false)
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      })
      if (!res.ok) throw new Error('密码错误')
      setPassword('')
      // 重新加载以让侧边栏出现 admin 入口
      if (typeof window !== 'undefined') window.location.reload()
      return
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '登录失败' })
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
    setAuthed(false)
    setComments([])
    setMsg({ kind: 'ok', text: '已退出站长登录' })
  }

  async function onDelete(id: number) {
    if (!confirm(`删除留言 #${id}(含其回复)?`)) return
    try {
      const res = await fetch('/api/admin/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('删除失败')
      await loadPage(listPage, pageSize)
      setMsg({ kind: 'ok', text: `已删除 #${id}` })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : '删除失败' })
    }
  }

  if (!ready) {
    return (
      <div className="zx-container" style={{ paddingBlock: '4rem' }}>
        <p className="zx-muted zx-mono">loading…</p>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="zx-container" style={{ maxWidth: 460, paddingBlock: '4rem' }}>
        <h1 className="zx-mono" style={{ fontSize: '1.4rem', marginBottom: '1rem' }}>
          🔒 ADMIN
        </h1>
        <form className="zx-form" onSubmit={(e) => void login(e)}>
          <div className="zx-field">
            <label className="zx-label" htmlFor="pw">
              admin password
            </label>
            <input
              id="pw"
              type="password"
              className="zx-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <button className="zx-btn zx-btn-primary" type="submit" disabled={busy}>
            {busy ? '验证中…' : '进入'}
          </button>
          {msg && <div className={`zx-msg ${msg.kind}`}>{msg.text}</div>}
        </form>
      </div>
    )
  }

  const tops = comments.filter((c) => !c.parent_id).slice().reverse()
  const repliesOf = (id: number) => comments.filter((c) => c.parent_id === id)
  // 归档:与留言板一致,按根留言 + 子回复嵌套展示(顺序已由接口按删除时间排好)
  const archRoots = archived.filter((c) => !c.parent_id)
  const archRepliesOf = (id: number) => archived.filter((c) => c.parent_id === id)

  return (
    <div className="zx-container" style={{ paddingBlock: '2.5rem' }}>
      <div className="zx-sec-head">
        <span className="zx-sec-tag">// ADMIN</span>
        {showTabs ? (
          <div className="zx-tabs is-inline">
            {(['comments', 'archive', 'stats', 'profile', 'token', 'projects'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`zx-tab${tab === t ? ' is-active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'comments'
                  ? '留言'
                  : t === 'archive'
                    ? '归档'
                    : t === 'stats'
                      ? '统计'
                      : t === 'profile'
                        ? '个人信息'
                        : t === 'projects'
                          ? '项目'
                          : 'Token 用量'}
              </button>
            ))}
          </div>
        ) : (
          <h1 className="zx-sec-title">留言管理</h1>
        )}
        <button className="zx-btn zx-btn-sm zx-btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => void logout()}>
          退出登录
        </button>
      </div>

      {msg && <div className={`zx-msg ${msg.kind}`}>{msg.text}</div>}

      {(!showTabs || tab === 'projects') && (
        <AdminProjectsPanel active={!showTabs || tab === 'projects'} onNotify={(m) => setMsg(m)} />
      )}

      {(!showTabs || tab === 'profile') && (
      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          站长昵称 <span>留言/回复时自动使用</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            style={{ maxWidth: 240 }}
            value={nick}
            maxLength={32}
            placeholder="站长昵称"
            onChange={(e) => setNick(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            type="button"
            onClick={() => void saveNick()}
            disabled={nickBusy}
          >
            {nickBusy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      )}

      {(!showTabs || tab === 'profile') && (
      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          联系方式 <span>前台「关于」与页脚展示;电话不显示号码</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            style={{ maxWidth: 220 }}
            value={cEmail}
            placeholder="邮箱"
            onChange={(e) => setCEmail(e.target.value)}
          />
          <input
            className="zx-input"
            style={{ maxWidth: 180 }}
            value={cWechat}
            placeholder="微信号"
            onChange={(e) => setCWechat(e.target.value)}
          />
          <input
            className="zx-input"
            style={{ maxWidth: 180 }}
            value={cPhone}
            placeholder="电话(仅用于拨号/复制,不显示)"
            onChange={(e) => setCPhone(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            type="button"
            onClick={() => void saveContacts()}
            disabled={contactBusy}
          >
            {contactBusy ? '保存中…' : '保存联系方式'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
          <img
            src={qrUrl}
            alt="微信二维码预览"
            style={{ width: 120, borderRadius: 8, border: '1px solid var(--line)', display: 'block' }}
          />
          <label className="zx-btn zx-btn-sm" style={{ cursor: 'pointer' }}>
            {qrBusy ? '上传中…' : '上传 / 更新二维码'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              disabled={qrBusy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadQr(f)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <span className="zx-muted zx-mono" style={{ fontSize: '0.7rem' }}>
            PNG/JPEG/WebP · ≤800KB · 上传即生效
          </span>
        </div>
      </div>
      )}

      {(!showTabs || tab === 'token') && (
      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          DeepSeek 用量 <span>平台私有接口 · 需登录会话令牌</span>
        </h3>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', margin: '0 0 0.6rem' }}>
          状态:
          {ds?.configured ? (ds.expired ? '已过期(需重新同步)' : '已配置') : '未配置'}
          {ds?.exp ? ` · 有效期至 ${new Date(ds.exp).toLocaleString()}` : ''}
          {ds?.lastSync ? ` · 最近同步 ${new Date(ds.lastSync).toLocaleString()}` : ''}
          {ds?.lastData?.at
            ? ` · 上次成功 ${ds.lastData.count ?? 0} 行 @ ${new Date(ds.lastData.at).toLocaleString()}`
            : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            ref={dsBookmarkRef}
            className="zx-btn zx-btn-sm zx-btn-primary"
            draggable
            title="拖到浏览器书签栏;点击会在本页运行,请勿直接点击"
            onClick={(e) => e.preventDefault()}
            onDragStart={(e) => {
              e.currentTarget.href = bookmarkHref
            }}
          >
            ⇢ 拖到书签栏
          </a>
          <button
            className="zx-btn zx-btn-sm"
            onClick={() => void copyText(dsScript(), '控制台命令已复制(在 DeepSeek 页 F12 → Console 粘贴回车)')}
          >
            复制控制台命令
          </button>
          <button
            className="zx-btn zx-btn-sm"
            onClick={() => void copyText(dsTokenScript(), '取令牌命令已复制(在官网 Console 执行,回这里粘贴保存)')}
          >
            复制取令牌命令
          </button>
          <button
            className="zx-btn zx-btn-sm"
            disabled={dsBusy}
            onClick={() => void dsAction('refresh')}
          >
            {dsBusy ? '验证中…' : '验证 / 刷新'}
          </button>
          <button
            className="zx-btn zx-btn-sm zx-btn-ghost"
            disabled={dsBusy}
            onClick={() => {
              if (confirm('轮换同步密钥?旧书签/旧命令将失效')) void dsAction('rotate')
            }}
          >
            轮换密钥
          </button>
          <button
            className="zx-btn zx-btn-sm zx-btn-ghost"
            disabled={dsBusy || !ds?.configured}
            onClick={() => void dsAction('clear')}
          >
            清除令牌
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            style={{ maxWidth: 340 }}
            placeholder="或手动粘贴 userToken"
            value={dsToken}
            onChange={(e) => setDsToken(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm"
            disabled={dsBusy || !dsToken}
            onClick={() => void dsAction('save', dsToken)}
          >
            保存令牌
          </button>
        </div>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.68rem', marginTop: '0.6rem', lineHeight: 1.6 }}>
          用法(任选其一):① 登录 <span className="zx-accent">platform.deepseek.com/usage</span> 后,把「⇢ 拖到书签栏」
          拖到浏览器书签栏,再在该已登录页面点这个书签;② 或点「复制控制台命令」,在该页
          <span className="zx-accent"> F12 → Console</span> 粘贴回车(首次需输入 <span className="zx-accent">allow pasting</span>);
          ③ 或「复制取令牌命令」拿到令牌粘贴下方保存。令牌仅存服务器,不下发前端。
        </p>
        {ds?.lastError && <div className="zx-msg err">{ds.lastError}</div>}
      </div>
      )}

      {(!showTabs || tab === 'token') && showOc && (
      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          OpenCode 用量 <span>官方 Console 导出 · 今天/昨天分时</span>
        </h3>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', margin: '0 0 0.6rem' }}>
          状态:{oc?.configured ? '已配置' : '未配置'}
          {oc?.consoleUrl ? ` · Console:${oc.consoleUrl}` : ''}
          {oc?.lastData?.since ? ` · 覆盖 ${oc.lastData.since} 起` : ''}
          {oc?.lastData?.at
            ? ` · 上次成功 ${oc.lastData.count ?? 0} 个分时桶 @ ${new Date(oc.lastData.at).toLocaleString()}`
            : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 300, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            placeholder="Console 服务账号 Key(oc_sk_…)"
            value={ocKey}
            onChange={(e) => setOcKey(e.target.value)}
            autoComplete="off"
          />
          <input
            className="zx-input"
            style={{ maxWidth: 220, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            placeholder="Console URL(默认生产)"
            value={ocUrl}
            onChange={(e) => setOcUrl(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            disabled={ocBusy || !ocKey || (!!ocUrl && !/^https:\/\//.test(ocUrl))}
            onClick={() => void ocAction('save', ocKey, ocUrl || undefined)}
          >
            {ocBusy ? '保存中…' : '保存 Key'}
          </button>
          <button
            className="zx-btn zx-btn-sm"
            disabled={ocBusy}
            onClick={() => void ocAction('refresh')}
          >
            {ocBusy ? '验证中…' : '验证 / 刷新'}
          </button>
          <button
            className="zx-btn zx-btn-sm zx-btn-ghost"
            disabled={ocBusy || !oc?.configured}
            onClick={() => void ocAction('clear')}
          >
            清除
          </button>
        </div>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.68rem', marginTop: '0.6rem', lineHeight: 1.6 }}>
          到 <span className="zx-accent">opencode.ai/console(或 dev.opencode.ai/console)</span> → API keys
          创建 <span className="zx-accent">Service account</span> key(需用量读取权限),粘贴上方保存。
          官方仅提供最近 30 天(UTC 零点对齐);「今天/昨天」按小时趋势展示，其余区间按天。
          也可用环境变量 <span className="zx-accent">OPENCODE_SERVICE_KEY</span> /{' '}
          <span className="zx-accent">OPENCODE_CONSOLE_URL</span>(优先级更高)。Key 仅存服务器,不下发前端。
        </p>
        {oc?.lastError && <div className="zx-msg err">{oc.lastError}</div>}
      </div>
      )}

      {(!showTabs || tab === 'token') && showZhipu && (
      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          智谱用量 <span>monitor API · 按模型 token 区间汇总 + 配额</span>
        </h3>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.72rem', margin: '0 0 0.6rem' }}>
          状态:{zp?.configured ? '已配置' : '未配置'}
          {zp?.baseUrl ? ` · Base:${zp.baseUrl}` : ''}
          {zp?.lastData?.at ? ` · 上次成功 ${zp.lastData.count ?? 0} 个模型 @ ${new Date(zp.lastData.at).toLocaleString()}` : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 300, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            placeholder="智谱 API Key"
            value={zpKey}
            onChange={(e) => setZpKey(e.target.value)}
            autoComplete="off"
          />
          <input
            className="zx-input"
            style={{ maxWidth: 240, fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            placeholder="Base URL(默认 open.bigmodel.cn)"
            value={zpUrl}
            onChange={(e) => setZpUrl(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            disabled={zpBusy || !zpKey || (!!zpUrl && !/^https:\/\//.test(zpUrl))}
            onClick={() => void zpAction('save', zpKey, zpUrl || undefined)}
          >
            {zpBusy ? '保存中…' : '保存 Key'}
          </button>
          <button className="zx-btn zx-btn-sm" disabled={zpBusy} onClick={() => void zpAction('refresh')}>
            {zpBusy ? '验证中…' : '验证 / 刷新'}
          </button>
          <button className="zx-btn zx-btn-sm zx-btn-ghost" disabled={zpBusy || !zp?.configured} onClick={() => void zpAction('clear')}>
            清除
          </button>
        </div>
        <p className="zx-muted zx-mono" style={{ fontSize: '0.68rem', marginTop: '0.6rem', lineHeight: 1.6 }}>
          在 <span className="zx-accent">open.bigmodel.cn</span> → 个人中心 → API Keys 创建 Key 粘贴保存(国际站用{' '}
          <span className="zx-accent">https://api.z.ai</span>)。智谱无逐日/费用导出,仅提供区间内「按模型 token 总量」;
          配额接口对按量用户可能为空。也可用环境变量 <span className="zx-accent">ZHIPU_API_KEY</span> /{' '}
          <span className="zx-accent">ZHIPU_BASE_URL</span>(优先级更高)。Key 仅存服务器,不下发前端。
        </p>
        {zp?.lastError && <div className="zx-msg err">{zp.lastError}</div>}
      </div>
      )}

      {(!showTabs || tab === 'profile') && (
      <div className="zx-panel" style={{ marginBottom: '1rem' }}>
        <h3>
          修改密码 <span>存于数据库,优先于环境变量</span>
        </h3>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 180 }}
            value={curPw}
            placeholder="当前密码"
            onChange={(e) => setCurPw(e.target.value)}
          />
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 180 }}
            value={newPw}
            placeholder="新密码"
            onChange={(e) => setNewPw(e.target.value)}
          />
          <input
            className="zx-input"
            type="password"
            style={{ maxWidth: 180 }}
            value={newPw2}
            placeholder="确认新密码"
            onChange={(e) => setNewPw2(e.target.value)}
          />
          <button
            className="zx-btn zx-btn-sm zx-btn-primary"
            type="button"
            onClick={() => void savePassword()}
            disabled={pwBusy}
          >
            {pwBusy ? '保存中…' : '更新密码'}
          </button>
        </div>
      </div>
      )}

      {(!showTabs || tab === 'comments') && (
      <>
      <p className="zx-muted zx-mono" style={{ fontSize: '0.75rem' }}>
        // {total} 条留言(含私密与回复){loading ? ' · 加载中…' : ''} · 已登录状态在所有页面生效
      </p>

      <div className="zx-comments">
        {tops.length === 0 && <div className="zx-c-empty">暂无留言</div>}
        {tops.map((c) => (
          <div className="zx-comment" key={c.id}>
            <div className="zx-c-head">
              <span className="zx-c-author">{c.author}</span>
              {!!c.is_admin && <span className="zx-admin-tag">站长</span>}
              {c.visibility === 'private' && <span className="zx-private-tag">仅站长可见</span>}
              <span className="zx-c-time">
                #{c.id} · {fmtDateTime(c.created_at)}
              </span>
              {c.ip && <span className="zx-c-time">ip {c.ip}</span>}
              {c.author_cid && <span className="zx-c-time">cid {c.author_cid}</span>}
              <button
                className="zx-btn zx-btn-sm zx-btn-ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => void onDelete(c.id)}
              >
                delete
              </button>
            </div>
            <div className="zx-c-body">{c.body}</div>

            {repliesOf(c.id).map((r) => (
              <div className="zx-comment zx-reply" key={r.id}>
                <div className="zx-c-head">
                  <span className="zx-c-author">↳ {r.author}</span>
                  {!!r.is_admin && <span className="zx-admin-tag">站长</span>}
                  {r.visibility === 'private' && <span className="zx-private-tag">仅站长可见</span>}
                  <span className="zx-c-time">
                    #{r.id} · {fmtDateTime(r.created_at)}
                  </span>
                  {r.author_cid && <span className="zx-c-time">cid {r.author_cid}</span>}
                  <button
                    className="zx-btn zx-btn-sm zx-btn-ghost"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => void onDelete(r.id)}
                  >
                    delete
                  </button>
                </div>
                <div className="zx-c-body">{r.body}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <Pagination
        page={listPage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        disabled={loading}
        onPage={(p) => void loadPage(p, pageSize)}
        onPageSize={(s) => void loadPage(1, s)}
      />
      </>
      )}

      {showTabs && tab === 'stats' && (
      <>
      <p className="zx-muted zx-mono" style={{ fontSize: '0.75rem' }}>
        // 统计{statsLoading ? ' · 加载中…' : ''}
      </p>
      {!stats && <div className="zx-c-empty">暂无数据</div>}
      {stats && (
        <>
          <div className="zx-grid-stats" style={{ marginBottom: '1.2rem' }}>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.comments.total)}</div>
              <div className="zx-stat-label">留言总数</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.comments.today)}</div>
              <div className="zx-stat-label">今日新增</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.comments.publicCount)}</div>
              <div className="zx-stat-label">公开</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.comments.privateCount)}</div>
              <div className="zx-stat-label">仅站长可见</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.comments.authors)}</div>
              <div className="zx-stat-label">留言者</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.events.resumeDownloads)}</div>
              <div className="zx-stat-label">简历下载</div>
            </div>
          </div>

          <div className="zx-grid-stats" style={{ marginBottom: '1.2rem' }}>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.visits.pv)}</div>
              <div className="zx-stat-label">总访问</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.visits.uv)}</div>
              <div className="zx-stat-label">独立访客</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.visits.today.pv)}</div>
              <div className="zx-stat-label">今日访问</div>
            </div>
            <div className="zx-stat">
              <div className="zx-stat-now">{fmtInt(stats.visits.online)}</div>
              <div className="zx-stat-label">在线</div>
            </div>
          </div>

          <div className="zx-panel">
            <h3>
              项目点击 <span>按次数</span>
            </h3>
            {Object.keys(stats.events.clicksByTarget).length === 0 ? (
              <div className="zx-c-empty">暂无点击</div>
            ) : (
              <table className="zx-table">
                <thead>
                  <tr>
                    <th>项目</th>
                    <th className="num">点击</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.events.clicksByTarget)
                    .sort((a, b) => b[1] - a[1])
                    .map(([id, count]) => (
                      <tr key={id}>
                        <td>{PROJECTS.find((p) => p.id === id)?.name ?? id}</td>
                        <td className="num">{fmtInt(count)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="zx-panel">
            <h3>
              访客明细 <span>最近活跃 · 点击行展开操作记录</span>
            </h3>
            {(stats.visitors ?? []).length === 0 ? (
              <div className="zx-c-empty">暂无访客</div>
            ) : (
              <table className="zx-table">
                <thead>
                  <tr>
                    <th>访客</th>
                    <th className="num">访问</th>
                    <th className="num">留言</th>
                    <th className="num">简历</th>
                    <th>项目</th>
                    <th>最近活跃</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.visitors!.map((v) => (
                    <VisitorDetailRow
                      key={v.cid}
                      v={v}
                      open={statVisitor === v.cid}
                      onToggle={() => setStatVisitor(statVisitor === v.cid ? null : v.cid)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      </>
      )}

      {showTabs && tab === 'archive' && (
      <>
      <p className="zx-muted zx-mono" style={{ fontSize: '0.75rem' }}>
        // 归档 {archTotal} 条已删除留言(admin 或访客删除均可在此查看){archLoading ? ' · 加载中…' : ''}
      </p>

      <div className="zx-comments">
        {archRoots.length === 0 && <div className="zx-c-empty">归档为空</div>}
        {archRoots.map((c) => (
          <div className="zx-comment" key={c.id}>
            <div className="zx-c-head">
              <span className="zx-c-author">{c.author}</span>
              {!!c.is_admin && <span className="zx-admin-tag">站长</span>}
              {c.visibility === 'private' && <span className="zx-private-tag">仅站长可见</span>}
              <span className={`zx-arch-tag ${c.archived_by}`}>
                {c.archived_by === 'admin' ? '站长删除' : '访客删除'}
              </span>
              <span className="zx-c-time">
                #{c.id} · 原 {fmtDateTime(c.created_at)}
              </span>
              {c.ip && <span className="zx-c-time">ip {c.ip}</span>}
              {c.author_cid && <span className="zx-c-time">cid {c.author_cid}</span>}
              {c.archived_at && <span className="zx-c-time">归档 {fmtDateTime(c.archived_at)}</span>}
              <span
                className="zx-arch-actions"
                style={{ marginLeft: 'auto' }}
              >
                <button
                  className="zx-btn zx-btn-sm zx-btn-ghost"
                  type="button"
                  disabled={archBusy}
                  onClick={() => void onArchAction(c.id, 'restore')}
                >
                  恢复
                </button>
                <button
                  className="zx-btn zx-btn-sm zx-btn-ghost"
                  type="button"
                  disabled={archBusy}
                  onClick={() => void onArchAction(c.id, 'purge')}
                >
                  彻底删除
                </button>
              </span>
            </div>
            <div className="zx-c-body">{c.body}</div>

            {archRepliesOf(c.id).map((r) => (
              <div className="zx-comment zx-reply" key={r.id}>
                <div className="zx-c-head">
                  <span className="zx-c-author">↳ {r.author}</span>
                  {!!r.is_admin && <span className="zx-admin-tag">站长</span>}
                  {r.visibility === 'private' && <span className="zx-private-tag">仅站长可见</span>}
                  <span className={`zx-arch-tag ${r.archived_by}`}>
                    {r.archived_by === 'admin' ? '站长删除' : '访客删除'}
                  </span>
                  <span className="zx-c-time">
                    #{r.id} · 原 {fmtDateTime(r.created_at)}
                  </span>
                  {r.ip && <span className="zx-c-time">ip {r.ip}</span>}
                  {r.author_cid && <span className="zx-c-time">cid {r.author_cid}</span>}
                </div>
                <div className="zx-c-body">{r.body}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <Pagination
        page={archPage}
        totalPages={archTotalPages}
        total={archTotal}
        pageSize={archPageSize}
        disabled={archLoading}
        onPage={(p) => void loadArchive(p, archPageSize)}
        onPageSize={(s) => void loadArchive(1, s)}
      />
      </>
      )}
    </div>
  )
}
