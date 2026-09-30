import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTACT_BIND_KEYS, resolveAppTrack } from '../dist/ui/app-track.js'

test('空 bind → app_click(单独的应用点击)', () => {
  assert.deepEqual(resolveAppTrack({ id: 'rag' }), { type: 'app_click', target: 'rag' })
  assert.deepEqual(resolveAppTrack({ id: 'rag', bind: '' }), { type: 'app_click', target: 'rag' })
  assert.deepEqual(resolveAppTrack({ id: 'rag', bind: '   ' }), { type: 'app_click', target: 'rag' })
})

test('resume → resume_download(与简历下载按钮合并)', () => {
  assert.deepEqual(resolveAppTrack({ id: 'resume', bind: 'resume' }), { type: 'resume_download', target: '' })
})

test('联系方式键 → contact_click(与对应按钮合并)', () => {
  for (const k of CONTACT_BIND_KEYS) {
    assert.deepEqual(resolveAppTrack({ id: 'x', bind: k }), { type: 'contact_click', target: k })
  }
  assert.deepEqual(resolveAppTrack({ id: 'github', bind: 'github' }), {
    type: 'contact_click',
    target: 'github',
  })
})

test('项目 id → project_click(与项目卡「试用/repo」合并)', () => {
  assert.deepEqual(resolveAppTrack({ id: 'proj-app', bind: 'proj-8f58rlh81' }), {
    type: 'project_click',
    target: 'proj-8f58rlh81',
  })
})

test('未知值按项目 id 处理', () => {
  assert.deepEqual(resolveAppTrack({ id: 'x', bind: 'something-else' }), {
    type: 'project_click',
    target: 'something-else',
  })
})

test('bind 两端空白被裁掉', () => {
  assert.deepEqual(resolveAppTrack({ id: 'x', bind: '  resume  ' }), { type: 'resume_download', target: '' })
  assert.deepEqual(resolveAppTrack({ id: 'x', bind: ' github ' }), { type: 'contact_click', target: 'github' })
})

test('resume 优先于项目:不会被当成项目 id', () => {
  // resume 是保留字;即使用户真有个叫 resume 的项目,也仍按简历下载记
  assert.notEqual(resolveAppTrack({ id: 'x', bind: 'resume' }).type, 'project_click')
})
