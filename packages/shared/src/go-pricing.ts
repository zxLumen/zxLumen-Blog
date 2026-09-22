// OpenCode Go 订阅价目表(手动维护)。
//
// 来源:https://opencode.ai/docs/go/ ——「Token prices are per 1M tokens」。
// 说明:
// - Go 是包月订阅($10/月),官方 usage/export 的 `cost_micro_cents` 对 `billing_source=go`
//   恒为 0;面板费用由 token × 本表折算(与 Console 网页的「Cost」同口径)。
// - 部分模型分 Peak / Off-Peak(DeepSeek 系列):Peak = 周一至周五 01:00–04:00、06:00–10:00 UTC,
//   其余(含周末)为 Off-Peak。仅单档价的模型 peak/off 相同。
// - 价格为 1M tokens 的美元价;cacheWrite 为 '-' 的模型不支持(记 0)。
// - 促销:DeepSeek V4.1 Flash 现为 4x(至 2026-09-27)。促销体现在「月度限额」而非单价,
//   故单价仍用表内值;限额变化见 monthlyLimit。到期后请更新注释与月限额。

export type GoPrice = {
  /** 输入(未命中缓存) */
  input: number
  /** 输出 */
  output: number
  /** 缓存读取 */
  cacheRead: number
  /** 缓存写入(不支持则 0) */
  cacheWrite: number
}

export type GoModel = {
  id: string
  label: string
  /** 单一价(未分 peak) */
  flat?: GoPrice
  /** DeepSeek 系列分时价 */
  peak?: GoPrice
  offPeak?: GoPrice
  /** 月度限额(USD),仅信息用途 */
  monthlyLimit: number
  /** 促销截止(YYYY-MM-DD),到期需人工复核 */
  promoUntil?: string
}

// 常用价格片段
const P = (input: number, output: number, cacheRead: number, cacheWrite = 0): GoPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite,
})

export const GO_MODELS: GoModel[] = [
  // DeepSeek 系列(Peak / Off-Peak)
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', offPeak: P(0.15, 0.6, 0.003), peak: P(0.3, 1.2, 0.006), monthlyLimit: 60, promoUntil: '2026-09-27' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', offPeak: P(0.66, 1.98, 0.022), peak: P(1.32, 3.96, 0.044), monthlyLimit: 15 },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', offPeak: P(0.15, 0.6, 0.003), peak: P(0.3, 1.2, 0.006), monthlyLimit: 30 },
  { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Flash Vision Exp', offPeak: P(0.15, 0.6, 0.003), peak: P(0.3, 1.2, 0.006), monthlyLimit: 15 },
  // 其余(单一价)
  { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', flat: P(0.15, 0.5, 0.03), monthlyLimit: 60 },
  { id: 'glm-5.3', label: 'GLM-5.3', flat: P(1.4, 4.4, 0.26), monthlyLimit: 15 },
  { id: 'glm-5.2', label: 'GLM-5.2', flat: P(1.4, 4.4, 0.26), monthlyLimit: 60 },
  { id: 'glm-5.1', label: 'GLM-5.1', flat: P(1.4, 4.4, 0.26), monthlyLimit: 60 },
  { id: 'kimi-k3', label: 'Kimi K3', flat: P(3.0, 15.0, 0.3), monthlyLimit: 15 },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', flat: P(0.95, 4.0, 0.19), monthlyLimit: 60 },
  { id: 'kimi-k2.6', label: 'Kimi K2.6', flat: P(0.95, 4.0, 0.16), monthlyLimit: 60 },
  { id: 'longcat-2.0', label: 'LongCat-2.0', flat: P(0.3, 1.2, 0.006), monthlyLimit: 60 },
  { id: 'mimo-v2.6-flash', label: 'MiMo-V2.6-Flash', flat: P(0.14, 0.28, 0.0028), monthlyLimit: 60 },
  { id: 'mimo-v2.6-pro', label: 'MiMo-V2.6-Pro', flat: P(0.435, 0.87, 0.003625), monthlyLimit: 15 },
  { id: 'mimo-v2.5', label: 'MiMo-V2.5', flat: P(0.14, 0.28, 0.0028), monthlyLimit: 60 },
  { id: 'mimo-v2.5-pro', label: 'MiMo-V2.5-Pro', flat: P(0.435, 0.87, 0.003625), monthlyLimit: 15 },
  { id: 'minimax-m3', label: 'MiniMax M3', flat: P(0.3, 1.2, 0.06), monthlyLimit: 60 },
  { id: 'minimax-m2.7', label: 'MiniMax M2.7', flat: P(0.3, 1.2, 0.06, 0.375), monthlyLimit: 60 },
  { id: 'minimax-m2.5', label: 'MiniMax M2.5', flat: P(0.3, 1.2, 0.06, 0.375), monthlyLimit: 60 },
  { id: 'muse-spark-1.3-contributor', label: 'Muse Spark 1.3 Contributor', flat: P(0.1, 0.2, 0.002), monthlyLimit: 60 },
  { id: 'muse-spark-1.2-contributor', label: 'Muse Spark 1.2 Contributor', flat: P(0.1, 0.2, 0.002), monthlyLimit: 60 },
  { id: 'qwen3.8-max', label: 'Qwen3.8 Max', flat: P(2.0, 6.0, 0.25, 2.5), monthlyLimit: 15 },
  { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash', flat: P(0.15, 0.47, 0.016, 0.2), monthlyLimit: 30 },
  { id: 'qwen3.7-max', label: 'Qwen3.7 Max', flat: P(2.5, 7.5, 0.5, 3.125), monthlyLimit: 30 },
  // Qwen3.7/3.6 Plus 分 ≤/> 256K,取较低档(常见)并标注
  { id: 'qwen3.7-plus', label: 'Qwen3.7 Plus (≤256K)', flat: P(0.4, 1.6, 0.04, 0.5), monthlyLimit: 60 },
  { id: 'qwen3.6-plus', label: 'Qwen3.6 Plus (≤256K)', flat: P(0.5, 3.0, 0.05, 0.625), monthlyLimit: 60 },
  { id: 'hy4-preview', label: 'Hy4 preview', flat: P(0.834, 2.501, 0.042), monthlyLimit: 30 },
  { id: 'hy3', label: 'Hy3', flat: P(0.14, 0.58, 0.035), monthlyLimit: 60 },
  { id: 'grok-4.7', label: 'Grok 4.7 (≤200K)', flat: P(2.0, 6.0, 0.5), monthlyLimit: 15 },
  { id: 'grok-4.6', label: 'Grok 4.6 (≤200K)', flat: P(2.0, 6.0, 0.5), monthlyLimit: 15 },
  { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna (≤272K)', flat: P(0.2, 1.2, 0.02, 0.25), monthlyLimit: 15 },
]

const GO_MAP = GO_MODELS.reduce<Record<string, GoModel>>((acc, m) => {
  acc[m.id] = m
  return acc
}, {})

/** DeepSeek Peak 时段:周一至周五 01:00–04:00、06:00–10:00 UTC */
function isPeak(createdMs: number): boolean {
  const d = new Date(createdMs)
  const w = d.getUTCDay() // 0=Sun
  const h = d.getUTCHours()
  const weekday = w >= 1 && w <= 5
  return weekday && ((h >= 1 && h < 4) || (h >= 6 && h < 10))
}

/** 按模型 + 时间取单价;未收录返回 null */
export function goPriceOf(model: string, createdMs: number): GoPrice | null {
  const m = GO_MAP[model]
  if (!m) return null
  if (m.flat) return m.flat
  return isPeak(createdMs) ? (m.peak ?? m.offPeak ?? null) : (m.offPeak ?? m.peak ?? null)
}

/** 估算单条 Go 记录的费用(USD);未收录模型返回 0 */
export function estimateGoCost(
  model: string,
  createdMs: number,
  tokens: { input: number; output: number; cacheRead: number; cacheWrite?: number },
): number {
  const p = goPriceOf(model, createdMs)
  if (!p) return 0
  return (
    (tokens.input / 1e6) * p.input +
    (tokens.output / 1e6) * p.output +
    (tokens.cacheRead / 1e6) * p.cacheRead +
    ((tokens.cacheWrite ?? 0) / 1e6) * p.cacheWrite
  )
}

/** 模型是否为已收录(用于标注未收录模型) */
export const isGoModelKnown = (model: string): boolean => !!GO_MAP[model]

/** 过期促销检查:返回已到期的 promoUntil 列表(供 admin 提示更新价目) */
export function expiredPromos(now = Date.now()): GoModel[] {
  const today = new Date(now).toISOString().slice(0, 10)
  return GO_MODELS.filter((m) => m.promoUntil && m.promoUntil < today)
}
