import assert from 'node:assert/strict'
import test from 'node:test'

import type { StoredProject } from '../dist/schema.js'
import { mergeProjectsForSave, reorderVisible } from '../dist/ui/projects-order.js'

const p = (id: string, extra: Partial<StoredProject> = {}): StoredProject => ({
  id,
  name: id,
  desc: '',
  tech: [],
  status: 'online',
  kind: 'personal',
  ...extra,
})

const ids = (list: StoredProject[]) => list.map((x) => x.id)

test('reorderVisible:只重排可见项,垃圾箱原地不动', () => {
  const full = [p('a'), p('b', { deleted: true }), p('c'), p('d')]
  assert.deepEqual(ids(reorderVisible(full, ['d', 'a', 'c'])), ['d', 'b', 'a', 'c'])
})

test('reorderVisible:对账新增项(按邻居插回,不一律塞末尾)', () => {
  const full = [p('a'), p('b'), p('c')]
  // 拖拽时前端只见过 a、c;b 是别处新增的 —— 应插回 c 之前(a 之后)
  assert.deepEqual(ids(reorderVisible(full, ['c', 'a'])), ['c', 'a', 'b'])
})

test('mergeProjectsForSave:面板只改内容 → 顺序沿用 fresh(前端刚拖的),不被冲回', () => {
  const baseline = [p('a'), p('b'), p('c')]
  const fresh = [p('c'), p('a'), p('b')] // 前端把 c 拖到了最前
  const edited = [p('a', { name: 'A2' }), p('b'), p('c')] // 面板改了 a 的名字,顺序没动
  const out = mergeProjectsForSave(fresh, baseline, edited)
  assert.deepEqual(ids(out), ['c', 'a', 'b'])
  assert.equal(out.find((x) => x.id === 'a')?.name, 'A2')
})

test('mergeProjectsForSave:面板自己改过顺序 → 应用面板顺序', () => {
  const baseline = [p('a'), p('b'), p('c')]
  const fresh = [p('c'), p('a'), p('b')]
  const edited = [p('b'), p('a'), p('c')] // 面板里把 b 拖到最前
  assert.deepEqual(ids(mergeProjectsForSave(fresh, baseline, edited)), ['b', 'a', 'c'])
})

test('mergeProjectsForSave:新增 / 删除', () => {
  const baseline = [p('a'), p('b')]
  const fresh = [p('a'), p('b')]
  const edited = [p('a'), p('n')] // 删 b、加 n
  const out = mergeProjectsForSave(fresh, baseline, edited)
  assert.deepEqual(ids(out), ['a', 'n'])
})

test('mergeProjectsForSave:fresh 里 baseline 没见过的项(别处新增)保留', () => {
  const baseline = [p('a'), p('b')]
  const fresh = [p('a'), p('b'), p('x')] // sync:projects 刚加了 x
  const edited = [p('a', { name: 'A2' }), p('b')]
  const out = mergeProjectsForSave(fresh, baseline, edited)
  assert.deepEqual(ids(out), ['a', 'b', 'x'])
  assert.equal(out.find((v) => v.id === 'a')?.name, 'A2')
})

test('mergeProjectsForSave:冷置/恢复(垃圾箱)按内容生效', () => {
  const baseline = [p('a'), p('b')]
  const fresh = [p('a'), p('b')]
  const edited = [p('a', { deleted: true }), p('b')]
  const out = mergeProjectsForSave(fresh, baseline, edited)
  assert.equal(out.find((v) => v.id === 'a')?.deleted, true)
})
