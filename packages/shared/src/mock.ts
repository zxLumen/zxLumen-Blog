import { roundCny, estimateCost, type UsageRow } from './pricing.js'

/**
 * 生成近 N 天的确定性伪随机 mock 用量数据。
 * 仅用于 demo 面板演示;真实数据来自你的 DeepSeek 服务上报。
 */
export function genMockUsage(days = 30, seed = 42): UsageRow[] {
  let s = seed
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }

  const rows: UsageRow[] = []
  const now = Date.now()
  const models = ['deepseek-chat', 'deepseek-reasoner']

  for (let d = days - 1; d >= 0; d--) {
    const sessions = 2 + Math.floor(rnd() * 5)
    for (let i = 0; i < sessions; i++) {
      const m = models[Math.floor(rnd() * models.length)]
      const ts = new Date(now - d * 86400_000 - Math.floor(rnd() * 86400_000) * 1000)
      const inputTokens = Math.floor(800 + rnd() * 25000)
      const outputTokens = Math.floor(400 + rnd() * 8000)
      const cacheHitTokens = Math.floor(rnd() * inputTokens * 0.7)
      rows.push({ ts: ts.toISOString(), model: m, inputTokens, outputTokens, cacheHitTokens })
    }
  }
  return rows
}

/** 按天聚合(便于画折线/柱状) */
export function dailyAggregate(rows: UsageRow[]) {
  const byDay = new Map<string, { input: number; output: number; cost: number }>()
  for (const r of rows) {
    const day = r.ts.slice(0, 10)
    const c = byDay.get(day) ?? { input: 0, output: 0, cost: 0 }
    c.input += r.inputTokens
    c.output += r.outputTokens
    c.cost += estimateCost(r).total
    byDay.set(day, c)
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const costRounded = days.map(([d, c]) => [d, c.input, c.output, roundCny(c.cost)] as const)
  return costRounded
}

/** 按模型聚合 */
export function modelAggregate(rows: UsageRow[]) {
  const byModel = new Map<string, { input: number; output: number; cost: number }>()
  for (const r of rows) {
    const c = byModel.get(r.model) ?? { input: 0, output: 0, cost: 0 }
    c.input += r.inputTokens
    c.output += r.outputTokens
    c.cost += estimateCost(r).total
    byModel.set(r.model, c)
  }
  return [...byModel.entries()].map(([model, c]) => ({
    model,
    input: c.input,
    output: c.output,
    cost: roundCny(c.cost),
  }))
}