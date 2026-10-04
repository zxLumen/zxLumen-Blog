import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeApps, isLocalhostUrl } from '../scripts/lib/sync-apps-core.mjs'

const app = (id: string, url = `https://${id}.zxlumen.cn/`) => ({
  id,
  name: id,
  url,
  openIn: 'panel',
  group: 'app',
})

test('isLocalhostUrl:认出各种本机地址', () => {
  for (const u of [
    'http://localhost:8789/',
    'http://127.0.0.1:3000/',
    'http://127.1.2.3/',
    'http://0.0.0.0:80/',
    'http://[::1]:8789/',
    'http://app.localhost/',
  ]) {
    assert.equal(isLocalhostUrl(u), true, u)
  }
})

test('isLocalhostUrl:公网 / 站内相对 / 非法值不算本机', () => {
  for (const u of ['https://stock.zxlumen.cn/', '/resume.pdf', 'https://github.com/zxLumen', '', 'not a url']) {
    assert.equal(isLocalhostUrl(u), false, u)
  }
})

test('线上没有的条目 → 追加到末尾', () => {
  const { merged, added } = mergeApps([app('a'), app('b')], [app('c')])
  assert.deepEqual(merged.map((x) => x.id), ['a', 'b', 'c'])
  assert.deepEqual(added.map((x) => x.id), ['c'])
})

test('线上已有的默认跳过,且不改动它(线上可能被 admin 改过)', () => {
  const remote = [{ ...app('a'), name: '线上改过的名字', group: 'info' }]
  const { added, skipped, merged } = mergeApps(remote, [app('a')])
  assert.equal(added.length, 0)
  assert.deepEqual(skipped.map((x) => x.id), ['a'])
  assert.equal(merged[0].name, '线上改过的名字')
  assert.equal(merged[0].group, 'info')
})

test('--update 才按本地覆盖线上已有的', () => {
  const remote = [{ ...app('a'), name: '旧名', group: 'info' }]
  // 本地这条不带 group → 覆盖时线上独有的字段要保留
  const { merged, changed } = mergeApps(remote, [{ id: 'a', name: '新名', url: app('a').url }], { update: true })
  assert.deepEqual(changed.map((x) => x.id), ['a'])
  assert.equal(merged[0].name, '新名')
  assert.equal(merged[0].group, 'info', '线上独有的字段要保留')
})

test('线上独有的条目一律保留(只加不减)', () => {
  const remote = [app('a'), app('app-线上后台建的'), app('b')]
  const { merged, remoteOnly } = mergeApps(remote, [app('c')])
  assert.deepEqual(merged.map((x) => x.id), ['a', 'app-线上后台建的', 'b', 'c'])
  assert.deepEqual(remoteOnly.map((x) => x.id), ['a', 'app-线上后台建的', 'b'])
})

test('--after 插到指定 id 之后;找不到则追加并标记 afterMiss', () => {
  const a = mergeApps([app('a'), app('b')], [app('new')], { after: 'a' })
  assert.deepEqual(a.merged.map((x) => x.id), ['a', 'new', 'b'])
  assert.equal(a.afterMiss, false)

  const b = mergeApps([app('a')], [app('new')], { after: '不存在' })
  assert.deepEqual(b.merged.map((x) => x.id), ['a', 'new'])
  assert.equal(b.afterMiss, true)
})

test('localhost 地址默认被挡,不写线上', () => {
  const { merged, added, blocked } = mergeApps([app('a')], [app('stock', 'http://localhost:8789/')])
  assert.deepEqual(merged.map((x) => x.id), ['a'], '不能把 localhost 写进去')
  assert.equal(added.length, 0)
  assert.deepEqual(blocked.map((x) => x.id), ['stock'])
})

test('--update 时 localhost 也挡(不覆盖线上正确地址)', () => {
  const remote = [app('stock')]
  const { merged, changed, blocked } = mergeApps(
    remote,
    [app('stock', 'http://localhost:8789/')],
    { update: true },
  )
  assert.deepEqual(changed, [])
  assert.deepEqual(blocked.map((x) => x.id), ['stock'])
  assert.equal(merged[0].url, 'https://stock.zxlumen.cn/', '线上地址保持不变')
})

test('allowLocalhost 放行 localhost', () => {
  const { added } = mergeApps([], [app('stock', 'http://localhost:8789/')], { allowLocalhost: true })
  assert.deepEqual(added.map((x) => x.id), ['stock'])
})

test('幂等:把结果当线上再合一次,不再有任何改动', () => {
  const first = mergeApps([app('a')], [app('b'), app('a')])
  const second = mergeApps(first.merged, [app('b'), app('a')])
  assert.equal(second.added.length, 0)
  assert.equal(second.changed.length, 0)
  assert.equal(second.skipped.length, 2)
})

test('不修改传入的数组', () => {
  const remote = [app('a')]
  const wanted = [app('b')]
  mergeApps(remote, wanted, { update: true })
  assert.deepEqual(remote.map((x) => x.id), ['a'])
  assert.deepEqual(wanted.map((x) => x.id), ['b'])
})
