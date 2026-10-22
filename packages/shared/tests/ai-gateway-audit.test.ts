import { test } from 'node:test'
import assert from 'node:assert/strict'

import { auditGatewayConfig, isModelInList, modelOptions } from '../dist/ai-gateway-audit.js'

/** 面板/服务端共用的"隐形模型"体检逻辑 */

const providers = [
  { id: 'p-ds', name: 'stock', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'] },
  { id: 'p-go', name: 'opencode', model: '', models: ['deepseek-v4.1-flash'] },
  { id: 'p-new', name: '新建', model: '', models: [] },
]

test('modelOptions:当前值在列表里 → 原样返回、不算失效', () => {
  const r = modelOptions(['a', 'b'], 'a')
  assert.deepEqual(r, { options: ['a', 'b'], stale: false })
})

test('modelOptions:当前值不在列表里 → 并进候选项(否则 Mantine 会渲染成空白)', () => {
  const r = modelOptions(['deepseek-flash'], 'deepseek-v4.1-flash')
  assert.deepEqual(r, { options: ['deepseek-v4.1-flash', 'deepseek-flash'], stale: true })
})

test('modelOptions:空值 / 空列表 / 重复项', () => {
  assert.deepEqual(modelOptions(['a'], ''), { options: ['a'], stale: false })
  assert.deepEqual(modelOptions(undefined, 'x'), { options: ['x'], stale: true })
  assert.deepEqual(modelOptions(['a', 'a'], 'a'), { options: ['a'], stale: false })
})

test('isModelInList:空列表视为"不校验"(新密钥刚建不该报错)', () => {
  assert.equal(isModelInList([], 'whatever'), true)
  assert.equal(isModelInList(['x'], ''), true)
  assert.equal(isModelInList(['x'], 'y'), false)
})

test('audit:应用固定模型不在绑定密钥的列表里 → app-model-stale', () => {
  const issues = auditGatewayConfig({
    apps: [{ id: 'app-1', name: 'stock', providerId: 'p-ds', model: 'deepseek-v4.1-flash' }],
    providers,
  })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, 'app-model-stale')
  assert.equal(issues[0].subjectName, 'stock')
  assert.equal(issues[0].providerName, 'stock')
  assert.match(issues[0].message, /deepseek-v4\.1-flash/)
})

test('audit:应用绑定的密钥不存在 → app-provider-missing(且不再报模型失效)', () => {
  const issues = auditGatewayConfig({
    apps: [{ id: 'app-2', name: '幽灵', providerId: 'p-gone', model: 'x' }],
    providers,
  })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, 'app-provider-missing')
})

test('audit:密钥自己的默认模型不在自己的列表里 → provider-model-stale', () => {
  const issues = auditGatewayConfig({
    apps: [],
    providers: [{ id: 'p-x', name: '旧密钥', model: 'gone-model', models: ['new-model'] }],
  })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].kind, 'provider-model-stale')
})

test('audit:正常配置 → 无问题(空 model / 空列表都不报)', () => {
  const issues = auditGatewayConfig({
    apps: [
      { id: 'app-3', name: 'ok', providerId: 'p-ds', model: 'deepseek-flash' },
      { id: 'app-4', name: '自选', providerId: 'p-ds', model: '' },
      { id: 'app-5', name: '未绑定', providerId: '', model: 'deepseek-v4.1-flash' },
      { id: 'app-6', name: '新密钥', providerId: 'p-new', model: 'anything' },
    ],
    providers,
  })
  assert.deepEqual(issues, [])
})

test('audit:多应用多密钥时顺序稳定(密钥问题在前,应用按配置顺序)', () => {
  const issues = auditGatewayConfig({
    apps: [
      { id: 'a1', name: 'A', providerId: 'p-ds', model: 'nope-1' },
      { id: 'a2', name: 'B', providerId: 'p-ds', model: 'nope-2' },
    ],
    providers: [{ id: 'p-ds', name: '密钥', model: 'nope-0', models: ['deepseek-flash'] }],
  })
  assert.deepEqual(
    issues.map((x) => `${x.kind}:${x.subjectId}`),
    ['provider-model-stale:p-ds', 'app-model-stale:a1', 'app-model-stale:a2'],
  )
})
