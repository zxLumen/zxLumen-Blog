import test from 'node:test'
import assert from 'node:assert/strict'

import { freshDb } from '../helpers/memdb.mjs'

test('meta:set / get / del / 前缀列举', () => {
  const db = freshDb()
  assert.equal(db.getMeta('nope'), null)
  db.setMeta('k1', 'v1')
  db.setMeta('prefix:a', 'x')
  db.setMeta('prefix:b', 'y')
  assert.equal(db.getMeta('k1'), 'v1')
  assert.deepEqual(db.listMetaKeys('prefix:').sort(), ['prefix:a', 'prefix:b'])
  db.delMeta('k1')
  assert.equal(db.getMeta('k1'), null)
  db.close()
})

test('usage:写入 / 窗口 / 全量', () => {
  const db = freshDb()
  db.addUsage({ model: 'deepseek-chat', inputTokens: 10, outputTokens: 5, cacheHitTokens: 2 })
  db.addUsage({ model: 'deepseek-reasoner', inputTokens: 20, outputTokens: 1 })

  assert.equal(db.allUsage().length, 2)
  assert.equal(db.listUsage(1).length, 2) // 今天两条
  const row = db.allUsage().find((r) => r.model === 'deepseek-chat')
  assert.equal(row.inputTokens, 10)
  assert.equal(row.outputTokens, 5)
  assert.equal(row.cacheHitTokens, 2)
  assert.equal(row.source, 'report') // 默认 source

  db.close()
})

test('ai_usage:同键累加、区间读取、按应用重置', () => {
  const db = freshDb()
  const base = { day: '2026-01-01', hour: 5, appId: 'app1', providerId: 'p1', model: 'm1' }

  db.addAiUsage({ ...base, requests: 1, inputTokens: 10, outputTokens: 2 })
  db.addAiUsage({ ...base, requests: 1, inputTokens: 30, outputTokens: 4 })

  let rows = db.listAiUsage({ from: '2026-01-01', to: '2026-01-01' })
  assert.equal(rows.length, 1) // 同键聚合为一行
  assert.equal(rows[0].requests, 2)
  assert.equal(rows[0].inputTokens, 40)
  assert.equal(rows[0].outputTokens, 6)

  // 不同应用 / 不同小时各占一行
  db.addAiUsage({ ...base, appId: 'app2', requests: 1 })
  db.addAiUsage({ ...base, hour: 6, requests: 1 })
  assert.equal(db.listAiUsage({ from: '2026-01-01', to: '2026-01-01' }).length, 3)

  // 区间外不返回
  assert.equal(db.listAiUsage({ from: '2026-02-01', to: '2026-02-28' }).length, 0)

  // 按应用重置(app1 有 hour5 / hour6 两行)
  assert.equal(db.resetAiUsage('app1'), 2)
  assert.equal(db.listAiUsage().some((r) => r.appId === 'app1'), false)
  // 全部重置(只剩 app2 一行)
  assert.equal(db.resetAiUsage(), 1)
  assert.equal(db.listAiUsage().length, 0)

  db.close()
})
