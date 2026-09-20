// DeepSeek 计价表(单位:¥ / 百万 tokens)、官方价目为准,可随时修改同步
import type { UsageRow } from './schema.js'
export type { UsageRow }

export interface ModelPrice {
  model: string
  label: string
  /** 官网页面上展示的名字 */
  official: string
  /** 输入命中缓存 ¥/M */
  inputCacheHit: number
  /** 输入未命中缓存 ¥/M */
  input: number
  /** 输出 ¥/M */
  output: number
  color: string
}

export const PRICING: ModelPrice[] = [
  {
    model: 'deepseek-chat',
    label: 'DS-V3 (chat)',
    official: 'deepseek-chat (V3)',
    inputCacheHit: 0.5,
    input: 2,
    output: 8,
    color: '#00b5ff',
  },
  {
    model: 'deepseek-reasoner',
    label: 'DS-R1 (reasoner)',
    official: 'deepseek-reasoner (R1)',
    inputCacheHit: 0.5,
    input: 4,
    output: 16,
    color: '#ff2b7a',
  },
]

export interface CostParts {
  cacheHit: number
  input: number
  output: number
  total: number
}

export const roundCny = (n: number) => Math.round(n * 10000) / 10000

export function estimateCost(row: UsageRow): CostParts {
  const p = PRICING.find((x) => x.model === row.model) ?? PRICING[0]
  const cacheHit = (row.cacheHitTokens / 1_000_000) * p.inputCacheHit
  const input = (row.inputTokens / 1_000_000) * p.input
  const output = (row.outputTokens / 1_000_000) * p.output
  return {
    cacheHit: roundCny(cacheHit),
    input: roundCny(input),
    output: roundCny(output),
    total: roundCny(cacheHit + input + output),
  }
}

export const costOfRows = (rows: UsageRow[]) =>
  rows.reduce((acc, r) => acc + estimateCost(r).total, 0)

export const tokensOf = (rows: UsageRow[]) => ({
  input: rows.reduce((a, r) => a + r.inputTokens, 0),
  output: rows.reduce((a, r) => a + r.outputTokens, 0),
  cacheHit: rows.reduce((a, r) => a + r.cacheHitTokens, 0),
  total: rows.reduce((a, r) => a + r.inputTokens + r.outputTokens + r.cacheHitTokens, 0),
})