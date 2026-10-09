import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeSiteContent } from '../dist/site-content-merge.js'
import type { SiteContentOverride } from '../dist/site-content-merge.js'

const base = {
  PROFILE: {
    name: '原名字',
    handle: 'orig',
    shell: 'sh',
    title: '原标题',
    location: '北京',
    email: 'a@b.c',
    bioLines: ['第一行', '第二行'],
    statusLine: '原状态',
  },
  LINKS: [{ label: 'github', url: 'https://github.com/x' }],
  TECH: [{ name: 'TS', level: 0.9, tags: ['web'] }],
  TIMELINE: [{ period: '2020', title: '工程师', org: 'A', desc: '做事' }],
  PROJECTS: [{ id: 'p1' }],
  SITE_META: { title: '站点', description: '描述', keywords: ['a'] },
  CONTACTS: { email: 'c@d.e' },
}

test('无覆盖时原样返回', () => {
  assert.equal(mergeSiteContent(base, undefined), base)
  assert.deepEqual(mergeSiteContent(base, {}), base)
})

test('PROFILE 按字段浅合并,未覆盖字段保留基底', () => {
  const out = mergeSiteContent(base, { PROFILE: { title: '新标题', statusLine: '新状态' } })
  assert.equal(out.PROFILE.title, '新标题')
  assert.equal(out.PROFILE.statusLine, '新状态')
  assert.equal(out.PROFILE.name, '原名字')
  assert.equal(out.PROFILE.location, '北京')
})

test('数组整组替换,而非按索引合并', () => {
  const out = mergeSiteContent(base, { TECH: [{ name: 'Go', level: 1, tags: [] }] })
  assert.deepEqual(out.TECH, [{ name: 'Go', level: 1, tags: [] }])
  // 未提交的数组保留基底
  assert.deepEqual(out.LINKS, base.LINKS)
})

test('SITE_META 浅合并', () => {
  const out = mergeSiteContent(base, { SITE_META: { description: '新描述' } })
  assert.equal(out.SITE_META.description, '新描述')
  assert.equal(out.SITE_META.title, '站点')
  assert.deepEqual(out.SITE_META.keywords, ['a'])
})

test('SECTIONS 与 PROJECTS/CONTACTS 一并透传', () => {
  const ov: SiteContentOverride = {
    SECTIONS: { about: { tag: '// 关于我', title: '关于' } },
  }
  const out = mergeSiteContent(base, ov)
  assert.deepEqual(out.SECTIONS, { about: { tag: '// 关于我', title: '关于' } })
  assert.deepEqual(out.PROJECTS, base.PROJECTS)
  assert.deepEqual(out.CONTACTS, base.CONTACTS)
})

test('空 profile 覆盖不改变基底', () => {
  const out = mergeSiteContent(base, { PROFILE: {} })
  assert.deepEqual(out.PROFILE, base.PROFILE)
})
