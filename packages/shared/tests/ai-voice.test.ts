import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AI_VOICE_FILES,
  AI_VOICE_FOR_STATE,
  AI_VOICE_MIN_GAP_MS,
  planVoice,
  pickVoiceFile,
  type AiVoiceEvent,
} from '../dist/ui/ai-voice.js'

const NOW = 1_800_000_000_000

/** 只想关心「这次跳变出不出声」,其余条件都给成「能出声」 */
function plan(p: Partial<Parameters<typeof planVoice>[0]> = {}) {
  return planVoice({
    prev: 'thinking',
    next: 'success',
    enabled: true,
    visible: true,
    lastPlayedAt: 0,
    now: NOW,
    ...p,
  })
}

test('只映射三个关键事件,中间态与 idle 都不出声', () => {
  assert.deepEqual(
    Object.keys(AI_VOICE_FOR_STATE).sort(),
    ['blocked', 'error', 'success'],
  )
  for (const s of ['idle', 'thinking', 'working', 'busy'] as const) {
    assert.equal(plan({ next: s }), null, `${s} 不该出声`)
  }
})

test('三个关键状态各自映射到对应事件', () => {
  assert.equal(plan({ prev: 'thinking', next: 'success' }), 'success')
  assert.equal(plan({ prev: 'thinking', next: 'error' }), 'error')
  assert.equal(plan({ prev: 'thinking', next: 'blocked' }), 'blocked')
})

test('首帧不播:刷新页面不该先听到一声', () => {
  assert.equal(plan({ prev: null, next: 'success' }), null)
})

test('状态没变不播(TTL ticker 每秒重渲染也不会连响)', () => {
  assert.equal(plan({ prev: 'success', next: 'success' }), null)
})

test('关闭时不播,且静音偏好下 planVoice 一律返回 null', () => {
  assert.equal(plan({ enabled: false }), null)
  for (const next of ['success', 'error', 'blocked'] as const) {
    assert.equal(plan({ enabled: false, prev: 'thinking', next }), null)
  }
})

test('页面不可见时不播(听不见还白吵)', () => {
  assert.equal(plan({ visible: false }), null)
})

test('最小间隔内不播,压制多源抖动导致的绿→黄→绿连响', () => {
  // 第一次出声:距离上次(0)已久
  assert.equal(plan({ lastPlayedAt: 0, now: NOW }), 'success')
  // 紧接着又来一次 error,间隔不够 → 吞掉
  assert.equal(
    plan({ prev: 'success', next: 'error', lastPlayedAt: NOW, now: NOW + 500 }),
    null,
  )
  // 过了间隔才放行
  assert.equal(
    plan({
      prev: 'success',
      next: 'error',
      lastPlayedAt: NOW,
      now: NOW + AI_VOICE_MIN_GAP_MS,
    }),
    'error',
  )
})

test('间隔按 gapMs 可调(测试不必等真实时间)', () => {
  assert.equal(plan({ lastPlayedAt: NOW, now: NOW + 999, gapMs: 1000 }), null)
  assert.equal(plan({ lastPlayedAt: NOW, now: NOW + 1000, gapMs: 1000 }), 'success')
})

test('pickVoiceFile:只会给出该事件自己的文件', () => {
  for (const ev of ['success', 'error', 'blocked'] as AiVoiceEvent[]) {
    const f = pickVoiceFile(ev)
    assert.ok(AI_VOICE_FILES[ev].includes(f), `${f} 不在 ${ev} 的候选里`)
  }
})

test('pickVoiceFile:尽量不与上一条重复(候选 >1 时)', () => {
  const list = AI_VOICE_FILES.success
  const first = list[0]
  // 排除上一条后,候选还剩多条;只要求「不是上一条」,具体哪条是随机的
  for (let i = 0; i < 20; i++) {
    assert.notEqual(pickVoiceFile('success', first), first)
  }
  // 反过来:上一条若本就不在候选里,则不受排除影响
  assert.ok(list.includes(pickVoiceFile('success', '/sounds/ai/nope.mp3')))
})

test('pickVoiceFile:只有一个候选时照用(不返回 undefined)', () => {
  const f = pickVoiceFile('error', '/sounds/ai/error-9.mp3')
  assert.ok(AI_VOICE_FILES.error.includes(f))
})