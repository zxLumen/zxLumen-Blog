import type { UsageRow } from './schema.js'
import { num, parseCsv } from './csv.js'

/**
 * DeepSeek 平台导出 `amount-YYYY-M.csv` 的解析。
 *
 * 平台**不保证列顺序/列数**:2026-10-17(V4.1-Flash-1017 上线)在 `model` 后面插入了
 * 一列 `name`(模型展示名),旧代码按位置解构 `[, date, model, apiKeyName, , type, price, amount]`,
 * 于是 type/price/amount 全部右移一格 → 所有指标算成 0 → 被 `isNonZeroRow` 过滤成空,
 * 而拉取本身"成功"(不报错),表现为「面板里 DeepSeek 用量整块消失、还没有任何报错」。
 *
 * 因此这里**一律按表头名取列**:未知列(如新增的 name / api_key / wallet_type)直接忽略,
 * 缺必需列则抛错 —— 宁可让面板显示"接口改版"的红色角标,也不要静默变成 0。
 *
 * 表头(新旧兼容):
 *   旧: user_id,utc_date,model,api_key_name,api_key,type,price,amount
 *   新: user_id,utc_date,model,name,api_key_name,api_key,type,price,amount
 */

/** 单次解析最多聚合多少行(防超大导出把内存打爆) */
export const MAX_AMOUNT_ROWS = 20_000

/** 必需列(缺任何一个都视为平台改版) */
const REQUIRED = ['utc_date', 'model', 'type', 'amount'] as const

export interface DeepseekAmountCsv {
  /** 按 (天 × 模型 × API Key) 聚合后的用量行 */
  rows: UsageRow[]
  /** 出现过的 API Key 名称 */
  apiKeys: string[]
  /** 表头之外的数据行数(用于判断"有数据但解析不出行") */
  dataLines: number
  /** 实际表头(报错时便于定位) */
  header: string[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^\ufeff/, '')

/** 解析平台导出的 amount CSV;表头不认识时抛错(不要静默返回空) */
export function parseAmountCsv(text: string): DeepseekAmountCsv {
  const lines = parseCsv(text)
  if (!lines.length) throw new Error('平台导出为空(没有表头)')

  const header = lines[0].map(norm)
  const col = (name: string) => header.indexOf(name)
  const missing = REQUIRED.filter((n) => col(n) < 0)
  if (missing.length) {
    throw new Error(
      `平台导出表头已变化:缺少 ${missing.join('/')}(实际表头:${lines[0].join(',')})`,
    )
  }

  const iDate = col('utc_date')
  const iModel = col('model')
  const iKey = col('api_key_name') // 可缺(老导出/匿名 Key)
  const iType = col('type')
  const iPrice = col('price') // 可缺:缺了只是不算费用
  const iAmount = col('amount')

  const rows = new Map<string, UsageRow>()
  const apiKeys = new Set<string>()
  const dataLines = lines.length - 1

  for (const line of lines.slice(1)) {
    if (rows.size >= MAX_AMOUNT_ROWS) break
    const date = line[iDate]
    const model = line[iModel]
    const day = String(date ?? '').slice(0, 10)
    if (!day || !model) continue
    const apiKey = iKey >= 0 ? String(line[iKey] ?? '') : ''
    apiKeys.add(apiKey)
    const k = `${day}|${model}|${apiKey}`
    const ex = rows.get(k)
    const row: UsageRow =
      ex ??
      ({
        ts: `${day}T00:00:00Z`,
        model,
        apiKey,
        inputTokens: 0,
        outputTokens: 0,
        cacheHitTokens: 0,
        requests: 0,
        cost: 0,
        source: 'deepseek',
      } as UsageRow)
    const amt = num(line[iAmount])
    switch (String(line[iType] ?? '')) {
      case 'request_count':
        row.requests = (row.requests ?? 0) + amt
        break
      case 'input_cache_hit_tokens':
        row.cacheHitTokens += amt
        row.inputTokens += amt
        break
      case 'input_cache_miss_tokens':
        row.inputTokens += amt
        break
      case 'output_tokens':
        row.outputTokens += amt
        break
    }
    const priceV = iPrice >= 0 ? Number(line[iPrice]) : 0
    if (Number.isFinite(priceV) && priceV > 0) row.cost = (row.cost ?? 0) + priceV * amt
    rows.set(k, row)
  }

  return { rows: [...rows.values()], apiKeys: [...apiKeys].filter(Boolean), dataLines, header }
}
