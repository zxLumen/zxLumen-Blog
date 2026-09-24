import type { GoQuota, ZhipuQuota } from './constants.js'

const fmtReset = (v?: string | number) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

/** OpenCode Go 订阅配额:每个 workspace 一行(5 小时 / 周 / 月,固定 3 列) */
export function GoQuotaPanel({ quotas }: { quotas: { name: string; quota: GoQuota | null }[] }) {
  return (
    <div className="zx-quota is-fixed3">
      {quotas.flatMap(({ name, quota }) =>
        quota
          ? (
              [
                ['5 小时', quota.rolling],
                ['本周', quota.weekly],
                ['本月', quota.monthly],
              ] as const
            ).map(([label, w]) => {
              const pct = Math.max(0, Math.min(100, Math.round(w?.percent ?? 0)))
              const resetTxt = fmtReset(w?.resetsAt)
              return (
                <div className="zx-quota-item" key={`${name}-${label}`}>
                  <div className="zx-quota-head">
                    <span className="zx-quota-label">
                      {name} · Go {label}
                    </span>
                    <span className="zx-quota-pct">{pct}%</span>
                  </div>
                  <div className="zx-quota-bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  {resetTxt && <div className="zx-quota-reset zx-muted zx-mono">重置 {resetTxt}</div>}
                </div>
              )
            })
          : [],
      )}
    </div>
  )
}

/** 智谱配额:5 小时 / 周 token + MCP 月度 */
export function ZhipuQuotaPanel({ quota }: { quota: ZhipuQuota }) {
  // TOKENS_LIMIT:按 nextResetTime 升序 → 5h(unit 3)、周(unit 6);TIME_LIMIT:MCP 月度
  const tokenLimits = quota.limits
    .filter((l) => l.type === 'TOKENS_LIMIT')
    .slice()
    .sort((a, b) => (a.nextResetTime ?? 0) - (b.nextResetTime ?? 0))
  const mcp = quota.limits.find((l) => l.type === 'TIME_LIMIT')
  const cells: { label: string; pct: number; reset?: number; sub?: string }[] = []
  if (tokenLimits[0]) {
    const l = tokenLimits[0]
    cells.push({ label: '5 小时', pct: Math.round(l.percentage ?? 0), reset: l.nextResetTime })
  }
  if (tokenLimits[1]) {
    const l = tokenLimits[1]
    cells.push({ label: '本周', pct: Math.round(l.percentage ?? 0), reset: l.nextResetTime })
  }
  if (mcp) {
    cells.push({
      label: 'MCP 月度',
      pct: Math.round(mcp.percentage ?? 0),
      reset: mcp.nextResetTime,
      sub:
        typeof mcp.remaining === 'number' && typeof mcp.usage === 'number'
          ? `${mcp.remaining}/${mcp.usage}`
          : undefined,
    })
  }
  return (
    <div className="zx-quota">
      {cells.map((c) => {
        const pct = Math.max(0, Math.min(100, c.pct))
        const resetTxt = fmtReset(c.reset)
        return (
          <div className="zx-quota-item" key={c.label}>
            <div className="zx-quota-head">
              <span className="zx-quota-label">
                智谱{quota.level ? ` · ${quota.level.toUpperCase()}` : ''} · {c.label}
              </span>
              <span className="zx-quota-pct">{pct}%</span>
            </div>
            <div className="zx-quota-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            {c.sub && <div className="zx-quota-reset zx-muted zx-mono">剩余 {c.sub}</div>}
            {resetTxt && <div className="zx-quota-reset zx-muted zx-mono">重置 {resetTxt}</div>}
          </div>
        )
      })}
    </div>
  )
}
