import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAmountCsv } from '../dist/deepseek-csv.js'

/**
 * DeepSeek 平台导出 amount CSV 的解析(2026-10-17 平台在 model 后插了 name 列)。
 * 这里锁死"按表头名解析"的行为,防止再次退回按位置解构 → 静默 0 行。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const fx = (n: string) => readFileSync(path.join(here, 'fixtures', n), 'utf8')

const approx = (a: number, b: number, msg?: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, msg ?? `期望 ${b},实际 ${a}`)

test('新表头(含 name 列):tokens/请求/费用都算对', () => {
  const r = parseAmountCsv(fx('deepseek-amount-new.csv'))
  assert.equal(r.dataLines, 6)
  assert.equal(r.rows.length, 2)
  assert.deepEqual(r.apiKeys.sort(), ['coding', 'default'])

  const d6 = r.rows.find((x) => x.ts.startsWith('2026-10-06'))
  assert.ok(d6)
  assert.equal(d6.model, 'deepseek-flash')
  assert.equal(d6.apiKey, 'coding')
  assert.equal(d6.requests, 177)
  assert.equal(d6.cacheHitTokens, 29_594_880)
  assert.equal(d6.inputTokens, 29_594_880 + 1_000_000) // 命中 + 未命中
  assert.equal(d6.outputTokens, 141_135)
  // 费用 = Σ price × amount
  approx(d6.cost ?? 0, 0.000004 * 141135 + 0.00000002 * 29594880 + 0.000002 * 1000000)

  const d7 = r.rows.find((x) => x.ts.startsWith('2026-10-07'))
  assert.ok(d7)
  assert.equal(d7.model, 'deepseek-v4-pro')
  assert.equal(d7.requests, 10)
  assert.equal(d7.outputTokens, 5000)
})

test('旧表头(无 name 列):结果与新表头完全一致', () => {
  const a = parseAmountCsv(fx('deepseek-amount-new.csv'))
  const b = parseAmountCsv(fx('deepseek-amount-old.csv'))
  assert.deepEqual(b.rows, a.rows)
  assert.deepEqual(b.apiKeys.sort(), a.apiKeys.sort())
})

test('列顺序打乱 + 多余列:照样按表头名解析', () => {
  const csv = [
    'amount,type,wallet_type,name,model,utc_date,api_key_name,user_id,price,api_key',
    '1000,output_tokens,Paid,x,deepseek-flash,2026-10-08,coding,u1,0.000004,sk-x',
  ].join('\n')
  const r = parseAmountCsv(csv)
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].outputTokens, 1000)
  assert.equal(r.rows[0].apiKey, 'coding')
  assert.equal(r.rows[0].ts, '2026-10-08T00:00:00Z')
})

test('缺必需列:抛错(而不是静默返回空)', () => {
  assert.throws(
    () => parseAmountCsv('user_id,utc_date,model,type,price\n u,2026-10-06,m,output_tokens,0'),
    /表头.*缺少.*amount/s,
  )
})

test('空文件 / 只有表头', () => {
  assert.throws(() => parseAmountCsv(''), /为空/)
  const r = parseAmountCsv('user_id,utc_date,model,type,amount')
  assert.equal(r.dataLines, 0)
  assert.equal(r.rows.length, 0)
})

test('price 列缺失也能解析(只是不算费用)', () => {
  const csv = ['utc_date,model,type,amount', '2026-10-09,deepseek-flash,output_tokens,42'].join('\n')
  const r = parseAmountCsv(csv)
  assert.equal(r.rows[0].outputTokens, 42)
  assert.equal(r.rows[0].cost, 0)
})

test('BOM + CRLF + 带引号字段', () => {
  const csv = '\ufeffutc_date,model,type,amount\r\n2026-10-10,"deepseek-flash",output_tokens,"123"\r\n'
  const r = parseAmountCsv(csv)
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].model, 'deepseek-flash')
  assert.equal(r.rows[0].outputTokens, 123)
})
