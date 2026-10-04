import assert from 'node:assert/strict'
import test from 'node:test'

import Database from 'better-sqlite3'

import { SCHEMA_SQL } from '../dist/schema.js'
import { creatureStore, MAX_CREATURES_PER_CID } from '../dist/server/db/creatures.js'

/**
 * 生物榜数据层测试。直接开内存库 + creatureStore(不走 openDb)。
 *
 * 关注三件事:
 *  - **归属**:`replaceCreature` / `deleteCreature` 必须只动同 cid 的行(防越权覆盖);
 *  - **版本门控**:`topCreatures` 只取当前 score_version(旧算法的分不可比);
 *  - **配额**:`countByCid` 供创建侧判定是否需覆盖。
 */

function setup() {
  const raw = new Database(':memory:')
  raw.exec(SCHEMA_SQL)
  const store = creatureStore(raw)
  return { raw, store }
}

function add(
  store: ReturnType<typeof creatureStore>,
  over: Partial<Parameters<ReturnType<typeof creatureStore>['addCreature']>[0]> = {},
) {
  return store.addCreature({
    cid: 'c1',
    descr: '一只猫',
    blueprint: '{}',
    dna: '{}',
    craft: 60,
    appeal: 50,
    total: 55,
    score_version: 'v1',
    ...over,
  })
}

test('addCreature 落库并原样读回', () => {
  const { store } = setup()
  const r = add(store, { descr: '一只赛博猫', total: 77.5 })
  assert.equal(r.descr, '一只赛博猫')
  assert.equal(r.total, 77.5)
  assert.equal(store.getCreature(r.id)?.total, 77.5)
})

test('listByCid 只返回本人,countByCid 正确', () => {
  const { store } = setup()
  add(store, { cid: 'c1' })
  add(store, { cid: 'c1' })
  add(store, { cid: 'c2' })
  assert.equal(store.listByCid('c1').length, 2)
  assert.equal(store.countByCid('c1'), 2)
  assert.equal(store.countByCid('c2'), 1)
})

test('replaceCreature 保留 id,且拒绝非本人', () => {
  const { store } = setup()
  const r = add(store, { cid: 'c1', descr: '旧的' })
  const ok = store.replaceCreature(r.id, 'c1', {
    descr: '新的',
    blueprint: '{}',
    dna: '{}',
    craft: 90,
    appeal: 80,
    total: 85,
    score_version: 'v1',
  })
  assert.equal(ok?.id, r.id)
  assert.equal(ok?.descr, '新的')
  // c2 不能覆盖 c1 的
  const denied = store.replaceCreature(r.id, 'c2', {
    descr: '偷改',
    blueprint: '{}',
    dna: '{}',
    craft: 0,
    appeal: 0,
    total: 0,
    score_version: 'v1',
  })
  assert.equal(denied, null)
  assert.equal(store.getCreature(r.id)?.descr, '新的')
})

test('topCreatures 按 total 降序且只取当前版本', () => {
  const { store } = setup()
  add(store, { descr: 'a', total: 50, score_version: 'v1' })
  add(store, { descr: 'b', total: 90, score_version: 'v1' })
  add(store, { descr: 'c', total: 99, score_version: 'v0' }) // 旧版本,不进榜
  const top = store.topCreatures('v1', 10)
  assert.deepEqual(top.map((r) => r.descr), ['b', 'a'])
})

test('deleteCreature 只删本人', () => {
  const { store } = setup()
  const r = add(store, { cid: 'c1' })
  assert.equal(store.deleteCreature(r.id, 'c2'), false)
  assert.equal(store.deleteCreature(r.id, 'c1'), true)
  assert.equal(store.getCreature(r.id), null)
})

test('MAX_CREATURES_PER_CID 为 5', () => {
  assert.equal(MAX_CREATURES_PER_CID, 5)
})
