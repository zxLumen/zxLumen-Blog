// 各源模型计价表(单位:¥ / 百万 tokens),官方价目为准,可随时修改同步
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
  // MiniMax(开放平台 CN 按量价目,元/百万 tokens;M Plan 用量按此折算「等效价」)
  // 来源:https://platform.minimaxi.com/docs/guides/pricing-paygo
  { model: 'MiniMax-M3', label: 'MiniMax M3', official: 'MiniMax-M3', inputCacheHit: 0.42, input: 2.1, output: 8.4, color: '#ff6b6b' },
  { model: 'MiniMax-M3-512k', label: 'MiniMax M3 (≤512k)', official: 'MiniMax-M3-512k', inputCacheHit: 0.42, input: 2.1, output: 8.4, color: '#ff8787' },
  // M3.1-Flash-Preview 仅 M Plan / MiniMax Code 提供,无按量价 → 暂按 M3 价近似
  { model: 'MiniMax-M3.1-Flash-Preview', label: 'MiniMax M3.1 Flash (预览)', official: 'MiniMax-M3.1-Flash-Preview', inputCacheHit: 0.42, input: 2.1, output: 8.4, color: '#fa5252' },
  { model: 'MiniMax-M2.7', label: 'MiniMax M2.7', official: 'MiniMax-M2.7', inputCacheHit: 0.42, input: 2.1, output: 8.4, color: '#f06595' },
  { model: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 HS', official: 'MiniMax-M2.7-highspeed', inputCacheHit: 0.42, input: 4.2, output: 16.8, color: '#e599f7' },
  { model: 'MiniMax-M2.5', label: 'MiniMax M2.5', official: 'MiniMax-M2.5', inputCacheHit: 0.21, input: 2.1, output: 8.4, color: '#845ef7' },
  { model: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 HS', official: 'MiniMax-M2.5-highspeed', inputCacheHit: 0.21, input: 4.2, output: 16.8, color: '#5c7cfa' },
  { model: 'MiniMax-M2.1', label: 'MiniMax M2.1', official: 'MiniMax-M2.1', inputCacheHit: 0.21, input: 2.1, output: 8.4, color: '#4dabf7' },
  { model: 'MiniMax-M2.1-highspeed', label: 'MiniMax M2.1 HS', official: 'MiniMax-M2.1-highspeed', inputCacheHit: 0.21, input: 4.2, output: 16.8, color: '#22b8cf' },
  { model: 'MiniMax-M2', label: 'MiniMax M2', official: 'MiniMax-M2', inputCacheHit: 0.21, input: 2.1, output: 8.4, color: '#20c997' },
]

/** 精确匹配 → 大小写不敏感匹配(MiniMax 模型名大小写/前缀可能变动) */
export function priceOf(model: string): ModelPrice | undefined {
  const exact = PRICING.find((x) => x.model === model)
  if (exact) return exact
  const key = model.trim().toLowerCase()
  return PRICING.find((x) => x.model.toLowerCase() === key)
}

export interface CostParts {
  cacheHit: number
  input: number
  output: number
  total: number
}

export const roundCny = (n: number) => Math.round(n * 10000) / 10000

export function estimateCost(row: UsageRow): CostParts {
  const p = priceOf(row.model) ?? PRICING[0]
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