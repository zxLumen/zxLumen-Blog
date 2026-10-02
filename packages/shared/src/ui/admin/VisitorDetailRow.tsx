'use client'

import { useEffect, useRef, useState } from 'react'
import type { AppItem, EventType, VisitorDetail } from '../../schema.js'
import { fmtInt } from '../../format.js'
import { SECTION_LABELS, type Project } from '../../content.js'

const EVENT_LABEL: Record<EventType, string> = {
  visit: '访问',
  project_click: '项目点击',
  resume_download: '简历下载',
  leave: '离开',
  section_view: '区块浏览',
  contact_click: '联系点击',
  vlog_play: '视频播放',
  app_click: '应用点击',
}

function targetLabel(t: string, projects: Project[]) {
  return projects.find((p) => p.id === t)?.name ?? t
}

/** 联系方式点击目标 → 中文名 */
const CONTACT_LABEL: Record<string, string> = {
  email: '邮件',
  wechat: '微信',
  phone: '电话',
  github: 'GitHub',
  guestbook: '留言',
}

/** 访客明细行:点击展开该访客的操作记录 */
export function VisitorDetailRow({
  v,
  open,
  onToggle,
  projects,
  apps,
  onAlias,
  aliasBusy,
}: {
  v: VisitorDetail
  open: boolean
  onToggle: () => void
  projects: Project[]
  apps?: AppItem[]
  /** 保存/清除该访客的备注(站长专用;不传则不显示备注入口) */
  onAlias?: (cid: string, alias: string) => void | Promise<void>
  /** 该访客备注正在保存中 */
  aliasBusy?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(v.alias)
  const inputRef = useRef<HTMLInputElement>(null)
  // 外部(重载 / 别的行保存)改了备注就同步进输入框
  useEffect(() => {
    if (!editing) setDraft(v.alias)
  }, [v.alias, editing])
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    const next = draft.trim().slice(0, 40)
    if (next === v.alias.trim()) {
      setEditing(false)
      return
    }
    await onAlias?.(v.cid, next)
    setEditing(false)
  }

  const appName = (id: string) => apps?.find((a) => a.id === id)?.name ?? id
  // 展示名优先级:站长备注 > 访客留言昵称 > cid 前 8 位
  const displayName = v.alias || v.nickname || `访客 ${v.cid.slice(0, 8)}`
  const proj = Object.entries(v.projectClicks)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${targetLabel(t, projects)}×${n}`)
    .join(' ')
  const m = (sec: number) => {
    if (sec >= 60) return `${Math.floor(sec / 60)}分${sec % 60 ? ` ${sec % 60}s` : ''}`
    return `${sec}s`
  }
  // 区块浏览聚合:区块名 → { count }
  const sectionAgg = new Map<string, { count: number }>()
  for (const e of v.recent) {
    if (e.type !== 'section_view' || !e.target) continue
    const id = e.target.split('#')[1] ?? e.target
    const cur = sectionAgg.get(id) ?? { count: 0 }
    cur.count += 1
    sectionAgg.set(id, cur)
  }
  const sectionList = [...sectionAgg.entries()].sort((a, b) => b[1].count - a[1].count)
  // 目标显示:区块浏览 → 中文区块名;离开 → 停留时长;其它 → 项目名/原值
  const showTarget = (type: string, target: string, dwell?: number) => {
    if (type === 'leave') return dwell ? `停留 ${m(dwell)}` : ''
    if (!target) return ''
    if (type === 'section_view') {
      const id = target.split('#')[1] ?? target
      return SECTION_LABELS[id] ?? target
    }
    if (type === 'contact_click') return CONTACT_LABEL[target] ?? target
    if (type === 'app_click') return appName(target)
    return targetLabel(target, projects)
  }
  const ops = v.recent
  return (
    <>
      <tr className={open ? 'is-open' : ''} onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td>
          {editing ? (
            <div className="zx-alias-edit" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={draft}
                maxLength={40}
                placeholder="给这位访客起个名字(仅自己可见)"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit()
                  if (e.key === 'Escape') {
                    setDraft(v.alias)
                    setEditing(false)
                  }
                }}
              />
              <button
                type="button"
                className="zx-btn zx-btn-sm"
                disabled={aliasBusy}
                onClick={() => void commit()}
              >
                保存
              </button>
            </div>
          ) : (
            <>
              <div>
                {v.alias ? <span className="zx-alias-tag">{v.alias}</span> : displayName}
                {v.alias && v.nickname ? (
                  <span className="zx-muted" style={{ fontSize: '0.7rem' }}>
                    {' '}
                    · {v.nickname}
                  </span>
                ) : null}
                <span
                  className={`zx-visitor-tag ${v.returning ? 'is-returning' : 'is-new'}`}
                  title={v.returning ? '回头客 · 分不同日期访问过' : '新客 · 仅当日访问'}
                >
                  {v.returning ? '回头客' : '新客'}
                </span>
                {onAlias && !aliasBusy ? (
                  <button
                    type="button"
                    className="zx-btn zx-btn-sm zx-btn-ghost zx-alias-btn"
                    title={v.alias ? '修改备注' : '给这位访客起个名字(仅自己可见)'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(true)
                    }}
                  >
                    {v.alias ? '备注' : '起名'}
                  </button>
                ) : null}
                {aliasBusy ? <span className="zx-muted zx-mono"> 保存中…</span> : null}
              </div>
              <div className="zx-mono zx-muted" style={{ fontSize: '0.65rem' }}>
                {v.cid}
              </div>
            </>
          )}
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
                  .map(([t, n]) => `${targetLabel(t, projects)} ×${n}`)
                  .join('、')}
              </div>
            )}

            <div className="zx-visitor-block">
              <span className="zx-visitor-block-title">看过区块</span>
              {sectionList.length > 0 ? (
                <span className="zx-proj-chips">
                  {sectionList.map(([id, s]) => (
                    <span key={id} className="zx-sec-chip">
                      {SECTION_LABELS[id] ?? `#${id}`} ×{s.count}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="zx-muted">—</span>
              )}
            </div>

            {ops.length > 0 && (
              <div className="zx-visitor-block">
                <span className="zx-visitor-block-title">最近操作</span>
                <div className="zx-visitor-ops zx-mono zx-muted">
                  {ops.map((e, i) => (
                    <div key={i} className="zx-visitor-op">
                      <span className="zx-op-time">{e.ts}</span>
                      <span className="zx-op-type">{EVENT_LABEL[e.type]}</span>
                      {showTarget(e.type, e.target, e.dwell) ? (
                        <span className="zx-op-target">{showTarget(e.type, e.target, e.dwell)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
