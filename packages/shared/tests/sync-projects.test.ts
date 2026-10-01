import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeProjects } from '../scripts/lib/sync-projects-core.mjs'

const card = (id: string, name = id) => ({ id, name, status: 'online', kind: 'personal' })

test('线上没有的条目 → 追加到末尾', () => {
  const remote = [card('a'), card('b')]
  const { merged, added, changed, skipped } = mergeProjects(remote, [card('c')])
  assert.deepEqual(
    merged.map((p) => p.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(added.map((p) => p.id), ['c'])
  assert.equal(changed.length, 0)
  assert.equal(skipped.length, 0)
})

test('线上已有的默认跳过,且**不改动**它(线上可能被 admin 改过)', () => {
  const remote = [{ ...card('a'), name: '线上改过的名字', featured: true }]
  const { merged, added, skipped } = mergeProjects(remote, [card('a', '本地名字')])
  assert.equal(added.length, 0)
  assert.deepEqual(skipped.map((p) => p.id), ['a'])
  assert.equal(merged[0].name, '线上改过的名字')
  assert.equal(merged[0].featured, true)
})

test('--update 才按本地覆盖线上已有的', () => {
  const remote = [{ ...card('a'), name: '线上旧名', featured: true }]
  const { merged, changed, added } = mergeProjects(remote, [card('a', '本地新名')], { update: true })
  assert.deepEqual(changed.map((p) => p.id), ['a'])
  assert.equal(added.length, 0)
  assert.equal(merged[0].name, '本地新名')
  assert.equal(merged[0].featured, true, '线上独有的字段要保留')
})

test('线上独有的条目一律保留(只加不减)', () => {
  // wanted 只给 c → a / proj-… / b 在本地列表里都没有,都算「仅线上有」
  const remote = [card('a'), card('proj-线上后台建的'), card('b')]
  const { merged, remoteOnly } = mergeProjects(remote, [card('c')])
  assert.deepEqual(
    merged.map((p) => p.id),
    ['a', 'proj-线上后台建的', 'b', 'c'],
  )
  assert.deepEqual(
    remoteOnly.map((p) => p.id),
    ['a', 'proj-线上后台建的', 'b'],
  )
})

test('本地列表覆盖线上全部 id 时,remoteOnly 为空(不误报「仅线上有」)', () => {
  const remote = [card('a'), card('b')]
  const { remoteOnly } = mergeProjects(remote, [card('a'), card('b')])
  assert.deepEqual(remoteOnly, [])
})

test('--after 插到指定 id 之后', () => {
  const remote = [card('a'), card('b'), card('c')]
  const { merged, afterMiss } = mergeProjects(remote, [card('new')], { after: 'a' })
  assert.deepEqual(
    merged.map((p) => p.id),
    ['a', 'new', 'b', 'c'],
  )
  assert.equal(afterMiss, false)
})

test('--after 指向不存在的 id → 追加末尾并标记 afterMiss(不整体失败)', () => {
  const remote = [card('a')]
  const { merged, afterMiss } = mergeProjects(remote, [card('new')], { after: '不存在' })
  assert.deepEqual(
    merged.map((p) => p.id),
    ['a', 'new'],
  )
  assert.equal(afterMiss, true)
})

test('幂等:把结果当线上再合一次,不再有任何改动', () => {
  const first = mergeProjects([card('a')], [card('b'), card('a')])
  const second = mergeProjects(first.merged, [card('b'), card('a')])
  assert.equal(second.added.length, 0)
  assert.equal(second.changed.length, 0)
  assert.equal(second.skipped.length, 2)
  assert.deepEqual(
    second.merged.map((p) => p.id),
    ['a', 'b'],
  )
})

test('不修改传入的数组(调用方可能还要用)', () => {
  const remote = [card('a')]
  const wanted = [card('b')]
  mergeProjects(remote, wanted, { update: true })
  assert.deepEqual(
    remote.map((p) => p.id),
    ['a'],
  )
  assert.deepEqual(
    wanted.map((p) => p.id),
    ['b'],
  )
})

test('空线上 → 全部新增,顺序即本地顺序', () => {
  const { merged, added } = mergeProjects([], [card('x'), card('y')])
  assert.deepEqual(
    merged.map((p) => p.id),
    ['x', 'y'],
  )
  assert.equal(added.length, 2)
})
