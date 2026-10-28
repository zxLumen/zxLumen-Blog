/**
 * OpenCode Go 订阅配额(5 小时 / 本周 / 本月)× 多 workspace 的合并规则。
 *
 * 放在 shared:服务端 `/api/usage` 用它合并,面板用的也是同一份类型,单测在 shared 侧。
 */

export interface GoQuotaWindow {
  percent: number
  status?: string
  resetsAt?: string
}

export interface GoQuota {
  rolling?: GoQuotaWindow
  weekly?: GoQuotaWindow
  monthly?: GoQuotaWindow
}

/** 本月用量达到该百分比即视为「已用满」 */
export const GO_MONTHLY_CAP_PCT = 100

/**
 * 把多个 workspace 的 Go 配额合并为「总体」:各窗口取**平均已用 %**,
 * 重置时间取最早的一个,状态取用量最高者的状态。
 *
 * 规则:**本月已达 100% 的 workspace 不参与合并**(对它自己来说 5 小时 / 本周的用量
 * 会因为被限流而自然掉到很低,混进平均会把「还剩多少余量」算得过于乐观)。
 * 只影响这三根配额条;模型 / 应用等用量统计仍然是全量。
 *
 * 若所有 workspace 本月都已用满 → 返回 null(没有可用余量可言,面板隐藏配额条)。
 */
export function mergeGoQuota(quotas: Array<GoQuota | null | undefined>): GoQuota | null {
  const valid = quotas.filter((q): q is GoQuota => !!q)
  if (!valid.length) return null
  const usable = valid.filter((q) => (q.monthly?.percent ?? 0) < GO_MONTHLY_CAP_PCT)
  if (!usable.length) return null

  const avg = (pick: (q: GoQuota) => GoQuotaWindow | undefined): GoQuotaWindow | undefined => {
    const ws = usable.map(pick).filter((w): w is GoQuotaWindow => !!w && typeof w.percent === 'number')
    if (!ws.length) return undefined
    const percent = ws.reduce((a, w) => a + w.percent, 0) / ws.length
    const resets = ws.map((w) => w.resetsAt).filter((x): x is string => !!x).sort()
    const worst = ws.slice().sort((a, b) => b.percent - a.percent)[0]
    return { percent: Math.round(percent * 10) / 10, resetsAt: resets[0], status: worst?.status }
  }

  return {
    rolling: avg((q) => q.rolling),
    weekly: avg((q) => q.weekly),
    monthly: avg((q) => q.monthly),
  }
}
