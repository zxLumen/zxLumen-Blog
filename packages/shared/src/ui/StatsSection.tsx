'use client'

import type { StatsResult } from '../schema.js'
import { fmtCompact, fmtInt } from '../format.js'
import { PROJECTS } from '../content.js'
import { Section } from './Section.js'
import { useFeature } from './theme-context.js'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="zx-stat">
      <div className="zx-stat-now">{value}</div>
      <div className="zx-stat-label">
        {label}
        {hint ? <span className="zx-muted"> · {hint}</span> : null}
      </div>
    </div>
  )
}

const projectName = (id: string) => PROJECTS.find((p) => p.id === id)?.name ?? id

/** 首页统计区块:访客 / 留言 / 事件(仅聚合数字,不含 cid/ip 明细) */
export function StatsSection({ stats }: { stats?: StatsResult }) {
  const on = useFeature('visitor-stats')
  if (!on || !stats) return null

  const { visits, comments, events } = stats
  const maxPv = Math.max(1, ...visits.days.map((d) => d.pv))

  return (
    <Section id="stats" tag="// STATS" num="03" title="统计">
      <div className="zx-grid-stats">
        <Stat label="总访问" value={fmtCompact(visits.pv)} />
        <Stat label="独立访客" value={fmtCompact(visits.uv)} />
        <Stat label="今日访问" value={fmtInt(visits.today.pv)} />
        <Stat label="今日访客" value={fmtInt(visits.today.uv)} />
        <Stat label="在线" value={fmtInt(visits.online)} hint="近5分钟" />
      </div>

      <div className="zx-panel" style={{ marginBottom: '1.6rem' }}>
        <h3>
          访客趋势 <span>近 30 天 · 访问量(PV)</span>
        </h3>
        <div className="zx-bars">
          {visits.days.map((d) => (
            <div
              key={d.day}
              className={`zx-bar${d.pv === 0 ? ' is-zero' : ''}`}
              data-label={`${d.day.slice(5)} · PV ${d.pv} / UV ${d.uv}`}
              style={{ height: `${Math.max(3, (d.pv / maxPv) * 100)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="zx-grid-stats">
        <Stat label="留言总数" value={fmtInt(comments.total)} />
        <Stat label="今日新增" value={fmtInt(comments.today)} />
        <Stat label="公开" value={fmtInt(comments.publicCount)} />
        <Stat label="仅站长可见" value={fmtInt(comments.privateCount)} />
        <Stat label="留言者" value={fmtInt(comments.authors)} />
        <Stat label="项目点击" value={fmtInt(events.projectClicks)} />
        <Stat label="简历下载" value={fmtInt(events.resumeDownloads)} />
      </div>

      {events.topProjects.length > 0 && (
        <div className="zx-panel">
          <h3>
            热门项目 <span>按点击次数</span>
          </h3>
          <table className="zx-table">
            <thead>
              <tr>
                <th>项目</th>
                <th className="num">点击</th>
              </tr>
            </thead>
            <tbody>
              {events.topProjects.map((p) => (
                <tr key={p.target}>
                  <td>{projectName(p.target)}</td>
                  <td className="num">{fmtInt(p.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
