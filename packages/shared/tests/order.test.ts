import assert from 'node:assert/strict'
import test from 'node:test'

import { applySavedOrder, groupContiguous, snapDropToGroup, type DropTarget } from '../dist/ui/useDragReorder.js'

interface App {
  id: string
  group?: string
}

const ids = (list: App[]) => list.map((a) => a.id)
const groupOf = (list: App[]) => (id: string) => list.find((a) => a.id === id)?.group ?? ''

/** 把「落到 targetId 的这一侧」真的执行一遍,和 hook 的 endDrag 用同一套算法 */
function commit(list: App[], from: number, hit: DropTarget): string[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  const target = list.findIndex((a) => a.id === hit.targetId) - (from < list.findIndex((a) => a.id === hit.targetId) ? 1 : 0)
  next.splice(hit.before ? target : target + 1, 0, moved)
  return ids(next)
}

test('groupContiguous:分组之前存下的交错顺序被归拢(本 bug 的现场)', () => {
  // 访客把 rag 拖到两个 info 中间,之后 admin 才把三者的分组改成现在这样
  const list: App[] = [
    { id: 'github', group: 'info' },
    { id: 'rag', group: 'app' },
    { id: 'resume', group: 'info' },
  ]
  assert.deepEqual(ids(groupContiguous(list)), ['github', 'resume', 'rag'])
})

test('groupContiguous:保持组内相对顺序', () => {
  const list: App[] = [
    { id: 'a2', group: 'g1' },
    { id: 'x', group: 'g2' },
    { id: 'b', group: 'g2' },
    { id: 'a1', group: 'g1' },
  ]
  // g1 内部 a2 在 a1 前、g2 内部 x 在 b 前,归拢都不能动这两组相对顺序
  assert.deepEqual(ids(groupContiguous(list)), ['a2', 'a1', 'x', 'b'])
})

test('groupContiguous:组间顺序按各组首个成员的首次出现位置', () => {
  const list: App[] = [
    { id: 'a1', group: 'x' },
    { id: 'b1', group: 'y' },
    { id: 'a2', group: 'x' },
  ]
  assert.deepEqual(ids(groupContiguous(list)), ['a1', 'a2', 'b1'])
})

test('groupContiguous:没分组的应用算一个隐式组,且不改变顺序', () => {
  const list: App[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(ids(groupContiguous(list)), ['a', 'b', 'c'])
  // 空组名与 undefined 必须等价,否则分隔线会莫名多一条
  const mixed: App[] = [{ id: 'a', group: '' }, { id: 'b' }, { id: 'c', group: 'g' }, { id: 'd' }]
  assert.deepEqual(ids(groupContiguous(mixed)), ['a', 'b', 'd', 'c'])
})

test('groupContiguous:幂等', () => {
  const list: App[] = [
    { id: 'github', group: 'info' },
    { id: 'rag', group: 'app' },
    { id: 'resume', group: 'info' },
  ]
  const once = groupContiguous(list)
  assert.deepEqual(ids(groupContiguous(once)), ids(once))
  // 已连续的顺序原样返回(不能动 admin 拖出来的相对位置)
  assert.deepEqual(ids(groupContiguous(once)), ['github', 'resume', 'rag'])
})

test('groupContiguous:空数组', () => {
  assert.deepEqual(groupContiguous([]), [])
})

test('applySavedOrder:剔除已删 id,新增项插回它在 admin 列表里的前一个邻居之后', () => {
  const list: App[] = [{ id: 'a1' }, { id: 'b1' }, { id: 'b2' }, { id: 'a2' }, { id: 'c1' }]
  // 访客存的是 b1,c1,b2,a1,a3 —— a3 已被 admin 删掉,应被剔除
  const out = applySavedOrder(list, ['b1', 'c1', 'b2', 'a1', 'a3'])
  assert.equal(ids(out).includes('a3'), false)
  // a2 不在存档里(admin 后加的),按 admin 列表里它的前一个邻居 b2 插回去,
  // 而不是一律塞到末尾
  assert.deepEqual(ids(out), ['b1', 'c1', 'b2', 'a2', 'a1'])
})

test('applySavedOrder:无存档时原样返回 admin 列表', () => {
  const list: App[] = [{ id: 'a' }, { id: 'b' }]
  assert.equal(applySavedOrder(list, null), list)
  assert.deepEqual(ids(applySavedOrder(list, [])), ['a', 'b'])
})

test('applySavedOrder:剔除 admin 已删的 id', () => {
  const list: App[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(ids(applySavedOrder(list, ['c', 'x', 'a'])), ['c', 'a', 'b'])
})

test('applySavedOrder:admin 列表**首位**的新增项插到最前,不追加到栏尾', () => {
  const list: App[] = [{ id: 'csdn' }, { id: 'a' }, { id: 'b' }]
  // 访客存档里没有 csdn(admin 刚加的头条),且访客自己排过序
  assert.deepEqual(ids(applySavedOrder(list, ['b', 'a'])), ['csdn', 'b', 'a'])
  // 无存档时不受影响
  assert.deepEqual(ids(applySavedOrder(list, null)), ['csdn', 'a', 'b'])
})

test('snapDropToGroup:拖到别的组中间时落到组边界,不落中间', () => {
  const list: App[] = [
    { id: 'github', group: 'info' },
    { id: 'resume', group: 'info' },
    { id: 'rag', group: 'app' },
  ]
  const g = groupOf(list)
  // 把 rag 拖到两个 info 中间(resume 之前)→ 必须落到 info 组的边上
  const from = 2
  const hit = snapDropToGroup(ids(list), from, { targetId: 'resume', before: true }, g)
  const out = commit(list, from, hit)
  // 同组必连续 —— 这条是 admin 侧「全局恒成立」的根据
  const runs = out.map((id) => g(id))
  assert.deepEqual(
    runs.filter((x, i) => i === 0 || x !== runs[i - 1]).length,
    new Set(runs).size,
  )
  assert.deepEqual(out, ['github', 'resume', 'rag'])
})

test('snapDropToGroup:落点指示与实际提交一致(所见即所得)', () => {
  const list: App[] = [
    { id: 'a', group: 'g1' },
    { id: 'b', group: 'g1' },
    { id: 'c', group: 'g2' },
    { id: 'd', group: 'g2' },
  ]
  const g = groupOf(list)
  // 把 a 拖到 d 之后(末尾)→ 夹到 g2 段之后,而不是留在 g1 里
  const from = 0
  const hit = snapDropToGroup(ids(list), from, { targetId: 'd', before: false }, g)
  assert.deepEqual(commit(list, from, hit), ['b', 'c', 'd', 'a'])
})

test('snapDropToGroup:落在组段的两端是合法的,原样放行', () => {
  const list: App[] = [
    { id: 'a', group: 'g1' },
    { id: 'b', group: 'g2' },
    { id: 'c', group: 'g2' },
  ]
  const g = groupOf(list)
  // a 拖到 b 之前 = g2 段的开头,没切段
  assert.deepEqual(snapDropToGroup(ids(list), 0, { targetId: 'b', before: true }, g), {
    targetId: 'b',
    before: true,
  })
  // a 拖到 c 之后 = g2 段的末尾
  assert.deepEqual(snapDropToGroup(ids(list), 0, { targetId: 'c', before: false }, g), {
    targetId: 'c',
    before: false,
  })
})

test('snapDropToGroup:组内拖动自由,不夹', () => {
  const list: App[] = [
    { id: 'a', group: 'g1' },
    { id: 'b', group: 'g1' },
    { id: 'c', group: 'g1' },
    { id: 'x', group: 'g2' },
  ]
  const g = groupOf(list)
  const from = 2
  const hit = snapDropToGroup(ids(list), from, { targetId: 'a', before: true }, g)
  assert.deepEqual(hit, { targetId: 'a', before: true })
  assert.deepEqual(commit(list, from, hit), ['c', 'a', 'b', 'x'])
})

test('snapDropToGroup:全表同组时放行(没分组的应用不该被限制到表头表尾)', () => {
  const list: App[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const g = groupOf(list)
  const hit = { targetId: 'c', before: true }
  assert.deepEqual(snapDropToGroup(ids(list), 0, hit, g), hit)
})

test('snapDropToGroup:已规整过的落点再跑一次不动(幂等,提交路径只算一次也对得上)', () => {
  const list: App[] = [
    { id: 'a', group: 'g1' },
    { id: 'b', group: 'g2' },
    { id: 'c', group: 'g2' },
  ]
  const g = groupOf(list)
  const once = snapDropToGroup(ids(list), 0, { targetId: 'b', before: true }, g)
  assert.deepEqual(snapDropToGroup(ids(list), 0, once, g), once)
})

test('snapDropToGroup:落点目标已不存在时原样返回', () => {
  const list: App[] = [{ id: 'a' }, { id: 'b' }]
  const hit = { targetId: 'gone', before: true }
  assert.deepEqual(snapDropToGroup(ids(list), 0, hit, () => ''), hit)
})

test('snapDropToGroup:只两项 / 拖到最后一项时不会越界', () => {
  const two: App[] = [{ id: 'a' }, { id: 'b' }]
  assert.doesNotThrow(() => snapDropToGroup(['a', 'b'], 1, { targetId: 'a', before: false }, () => ''))
  assert.doesNotThrow(() => snapDropToGroup(ids(two), 0, { targetId: 'b', before: false }, groupOf(two)))
  const out = commit(two, 0, snapDropToGroup(ids(two), 0, { targetId: 'b', before: false }, groupOf(two)))
  assert.deepEqual(out, ['b', 'a'])
})
