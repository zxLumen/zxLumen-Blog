import type { GoQuota, MinimaxQuota, ZhipuQuota } from './constants.js'
import type { UsageRow } from '../../schema.js'

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

/** MiniMax M Plan 额度:按模型显示 5 小时 / 周 已用 %(不在套餐的窗口不显示) */
export function MinimaxQuotaPanel({ quota }: { quota: MinimaxQuota }) {
  const cells = quota.models.flatMap((m) => {
    const out: { key: string; label: string; pct: number; reset?: number }[] = []
    const push = (key: string, label: string, status: number | undefined, usedPct: number, reset?: number) => {
      if (status === 3) return // 不在套餐
      out.push({ key, label, pct: usedPct, reset })
    }
    push(`${m.name}-5h`, `${m.name} · 5 小时`, m.intervalStatus, m.intervalUsedPct, m.intervalResetMs)
    push(`${m.name}-wk`, `${m.name} · 本周`, m.weeklyStatus, m.weeklyUsedPct, m.weeklyResetMs)
    return out
  })
  return (
    <div className="zx-quota">
      {cells.map((c) => {
        const pct = Math.max(0, Math.min(100, Math.round(c.pct)))
        const resetTxt = fmtReset(c.reset)
        return (
          <div className="zx-quota-item" key={c.key}>
            <div className="zx-quota-head">
              <span className="zx-quota-label">MiniMax · {c.label}</span>
              <span className="zx-quota-pct">{pct}%{pct >= 100 ? ' · 已用尽' : ''}</span>
            </div>
            <div className="zx-quota-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            {resetTxt && <div className="zx-quota-reset zx-muted zx-mono">重置 {resetTxt}</div>}
          </div>
        )
      })}
      {typeof quota.creditBalance === 'number' && quota.creditBalance > 0 && (
        <div className="zx-quota-item">
          <div className="zx-quota-head">
            <span className="zx-quota-label">MiniMax · 积分余额</span>
            <span className="zx-quota-pct">{quota.creditBalance}</span>
          </div>
        </div>
      )}
    </div>
  )
}

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n)

/** AI 网关:按「应用令牌」与「密钥池(上游)」两个维度的用量排行(令牌维度、请求数) */
export function GatewayBreakdown({ rows }: { rows: UsageRow[] }) {
  const agg = (get: (r: UsageRow) => string) => {
    const m = new Map<string, { tokens: number; requests: number }>()
    for (const r of rows) {
      const k = get(r) || '(未绑定)'
      const cur = m.get(k) ?? { tokens: 0, requests: 0 }
      cur.tokens += r.inputTokens + r.outputTokens + r.cacheHitTokens
      cur.requests += r.requests ?? 0
      m.set(k, cur)
    }
    return Array.from(m, ([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 12)
  }
  const byApp = agg((r) => r.apiKey ?? '')
  const byProv = agg((r) => r.serviceAccount ?? '')
  const max = Math.max(1, ...byApp.map((x) => x.tokens), ...byProv.map((x) => x.tokens))
  const list = (title: string, items: { name: string; tokens: number; requests: number }[]) => (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div className="zx-quota-head" style={{ marginBottom: 4 }}>
        <span className="zx-quota-label">{title}</span>
      </div>
      {items.length === 0 ? (
        <div className="zx-muted zx-mono" style={{ fontSize: '0.68rem' }}>暂无</div>
      ) : (
        items.map((x) => (
          <div key={x.name} style={{ marginTop: 6 }}>
            <div className="zx-quota-head">
              <span className="zx-quota-label" style={{ fontWeight: 400 }}>{x.name}</span>
              <span className="zx-quota-pct">
                {fmtTokens(x.tokens)}
                {x.requests ? ` · ${x.requests}次` : ''}
              </span>
            </div>
            <div className="zx-quota-bar">
              <span style={{ width: `${Math.round((x.tokens / max) * 100)}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
  return (
    <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
      {list('按应用令牌', byApp)}
      {list('按密钥池(上游)', byProv)}
    </div>
  )
}
