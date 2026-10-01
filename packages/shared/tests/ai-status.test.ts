import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregateAiState,
  effectiveAiState,
  AI_PRIORITY,
  type AiSource,
  type AiState,
} from '../dist/ui/ai-status.js'

const NOW = 1_800_000_000_000

function src(partial: Partial<AiSource> & { state: AiState }): AiSource {
  return {
    id: partial.id ?? 'x',
    label: partial.label ?? 'x',
    ownerOnly: partial.ownerOnly ?? false,
    state: partial.state,
    at: partial.at ?? NOW,
    detail: partial.detail,
    available: partial.available ?? true,
  }
}

test('aggregateAiState:取优先级最高者,而不是最后一个上报的', () => {
  const list = [
    src({ id: 'a', state: 'working' }),
    src({ id: 'b', state: 'success' }),
    src({ id: 'c', state: 'thinking' }),
  ]
  assert.equal(aggregateAiState(list, true, NOW), 'success')
  assert.ok(AI_PRIORITY.success > AI_PRIORITY.working)
  assert.ok(AI_PRIORITY.working > AI_PRIORITY.thinking)
})

test('aggregateAiState:等你确认(blocked)压过一切', () => {
  const list = [src({ id: 'a', state: 'error' }), src({ id: 'b', state: 'blocked' })]
  assert.equal(aggregateAiState(list, true, NOW), 'blocked')
})

test('aggregateAiState:全空闲 → idle', () => {
  assert.equal(aggregateAiState([src({ state: 'idle' })], true, NOW), 'idle')
  assert.equal(aggregateAiState([], true, NOW), 'idle')
})

test('aggregateAiState:浮层关掉的源(available=false)不参与合并', () => {
  const list = [src({ id: 'avatar', state: 'idle' }), src({ id: 'opentodo', state: 'working', available: false })]
  assert.equal(aggregateAiState(list, true, NOW), 'idle')
  // 重新打开后立刻恢复参与
  assert.equal(aggregateAiState([{ ...list[1], available: true }], true, NOW), 'working')
})

test('aggregateAiState:ownerOnly 源只并入站长的灯,访客看不到', () => {
  const list = [src({ id: 'mac', state: 'blocked', ownerOnly: true })]
  assert.equal(aggregateAiState(list, true, NOW), 'blocked')
  assert.equal(aggregateAiState(list, false, NOW), 'idle')
})

test('effectiveAiState:成功/出错按 TTL 停留后回落到空闲', () => {
  // success 停 25s、error 停 60s;working 是进行中,停满 90s 也回落(防卡死)
  assert.equal(effectiveAiState(src({ state: 'success', at: NOW }), NOW), 'success')
  assert.equal(effectiveAiState(src({ state: 'success', at: NOW - 24_000 }), NOW), 'success')
  assert.equal(effectiveAiState(src({ state: 'success', at: NOW - 25_000 }), NOW), 'idle')
  assert.equal(effectiveAiState(src({ state: 'error', at: NOW - 59_000 }), NOW), 'error')
  assert.equal(effectiveAiState(src({ state: 'error', at: NOW - 60_000 }), NOW), 'idle')
  assert.equal(effectiveAiState(src({ state: 'working', at: NOW - 89_000 }), NOW), 'working')
  assert.equal(effectiveAiState(src({ state: 'working', at: NOW - 90_000 }), NOW), 'idle')
  // idle 常驻,没有 TTL
  assert.equal(effectiveAiState(src({ state: 'idle', at: 0 }), NOW), 'idle')
})

test('aggregateAiState:过期的高优先级不压住当下的低优先级', () => {
  // 25s 前那次 success 已经熄了,现在只有 avatar 在思考 → 应显示思考中
  const list = [src({ id: 'a', state: 'success', at: NOW - 30_000 }), src({ id: 'b', state: 'thinking' })]
  assert.equal(aggregateAiState(list, true, NOW), 'thinking')
})
