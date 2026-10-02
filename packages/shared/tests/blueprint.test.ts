import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeBlueprint,
  compileBlueprint,
  type CreatureBlueprint,
} from '../dist/creature/blueprint.js'

/* ---------------------------- 夹具 ---------------------------- */

/** 一份最小的合法蓝图:两个部件(身体 + 一个镜像翅膀),flap 运动 */
function sample(over: Record<string, unknown> = {}) {
  return {
    dna: {
      name: '测试虫',
      archetype: 'orb',
      palette: { body: '#7fe0ff', accent: '#ff5fa2', glow: '#b8f4ff' },
      traits: { luminous: 3 },
      motion: { flapHz: 2.4, driftAmp: 16, bobPx: 4, trail: 0.2, spin: 0.1 },
    },
    span: 80,
    matureDay: 24,
    parts: [
      { id: 'body', d: 'M -5 0 a 5 8 0 1 0 10 0 a 5 8 0 1 0 -10 0 Z', role: 'body', z: 1 },
      { id: 'wing', parent: 'body', d: 'M 0 0 C 20 -10 30 0 0 8 Z', role: 'accent', z: 2, mirror: true },
    ],
    motionCfg: { family: 'flap', period: 0.5, amplitude: 1 },
    ...over,
  }
}

/* ---------------------------- normalizeBlueprint ---------------------------- */

test('normalizeBlueprint:接受合法蓝图,补齐缺省', () => {
  const bp = normalizeBlueprint(sample())
  assert.ok(bp)
  assert.equal(bp.parts.length, 2)
  assert.equal(bp.parts[1].mirror, true)
  assert.equal(bp.motionCfg.family, 'flap')
  assert.equal(bp.matureDay, 24)
})

test('normalizeBlueprint:非对象 / 无合法部件 → null', () => {
  assert.equal(normalizeBlueprint(null), null)
  assert.equal(normalizeBlueprint('x'), null)
  assert.equal(normalizeBlueprint({}), null)
  assert.equal(normalizeBlueprint({ parts: [] }), null)
  // 全是坏路径 → 没有可用部件
  assert.equal(normalizeBlueprint({ parts: [{ d: 'not a path' }, { d: '' }] }), null)
})

test('normalizeBlueprint:没有 M/m 起点的路径被丢弃', () => {
  const bp = normalizeBlueprint(sample({ parts: [{ id: 'bad', d: 'L 10 10', role: 'body', z: 1 }] }))
  assert.equal(bp, null)
})

test('normalizeBlueprint:路径里的注入字符被拒', () => {
  const evil = 'M 0 0 L 10 10" onload="alert(1)'
  assert.equal(normalizeBlueprint(sample({ parts: [{ d: evil, role: 'body', z: 1 }] })), null)
  // 花括号 / 尖括号 / 分号同样拒绝
  for (const d of ['M 0 0 }', 'M 0 0 <svg>', 'M 0 0 ; DROP']) {
    assert.equal(normalizeBlueprint(sample({ parts: [{ d, role: 'body', z: 1 }] })), null, d)
  }
})

test('normalizeBlueprint:非法 role 退回 body,悬空 parent 提升为根', () => {
  const bp = normalizeBlueprint(
    sample({
      parts: [
        { id: 'body', d: 'M 0 0 L 5 5', role: 'NOT_A_ROLE', z: 1 },
        { id: 'x', parent: 'ghost', d: 'M 0 0 L 4 4', role: 'accent', z: 2 },
      ],
    }),
  )
  assert.ok(bp)
  assert.equal(bp.parts[0].role, 'body')
  assert.equal(bp.parts[1].parent, undefined)
})

test('normalizeBlueprint:自指 parent 被清除', () => {
  const bp = normalizeBlueprint(sample({ parts: [{ id: 'a', parent: 'a', d: 'M 0 0 L 4 4', role: 'body', z: 1 }] }))
  assert.ok(bp)
  assert.equal(bp.parts[0].parent, undefined)
})

test('normalizeBlueprint:数字被夹到合法区间', () => {
  const bp = normalizeBlueprint(sample({ span: 1e9, matureDay: -50 }))
  assert.ok(bp)
  assert.equal(bp.span, 400)
  assert.equal(bp.matureDay, 5)
})

test('normalizeBlueprint:非法颜色退回默认', () => {
  const bp = normalizeBlueprint(
    sample({ dna: { ...sample().dna, palette: { body: 'red', accent: '#GGG', glow: '#fff' } } }),
  )
  assert.ok(bp)
  assert.equal(bp.dna.palette.body, '#7fe0ff')
  assert.equal(bp.dna.palette.accent, '#ff5fa2')
  assert.equal(bp.dna.palette.glow, '#b8f4ff')
})

test('normalizeBlueprint:重复 id 自动去重(否则 rules 会指错)', () => {
  const bp = normalizeBlueprint(
    sample({
      parts: [
        { id: 'dup', d: 'M 0 0 L 4 4', role: 'body', z: 1 },
        { id: 'dup', d: 'M 0 0 L 6 6', role: 'accent', z: 2 },
      ],
    }),
  )
  assert.ok(bp)
  const ids = bp.parts.map((p) => p.id)
  assert.equal(new Set(ids).size, 2)
})

test('normalizeBlueprint:部件数上限被强制', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, d: 'M 0 0 L 3 3', role: 'body', z: i }))
  const bp = normalizeBlueprint(sample({ parts: many }))
  assert.ok(bp)
  assert.ok(bp.parts.length <= 64, `${bp.parts.length}`)
})

test('normalizeBlueprint:grow 的 to<=from 视为无效并丢弃', () => {
  const bp = normalizeBlueprint(
    sample({ parts: [{ id: 'a', d: 'M 0 0 L 4 4', role: 'body', z: 1, grow: { from: 20, to: 5 } }] }),
  )
  assert.ok(bp)
  assert.equal(bp.parts[0].grow, undefined)
})

test('normalizeBlueprint:幂等(过一遍和过两遍一致)', () => {
  const once = normalizeBlueprint(sample())!
  const twice = normalizeBlueprint(once)!
  assert.deepEqual(once, twice)
})

/* ---------------------------- compileBlueprint ---------------------------- */

test('compileBlueprint:产出合法 DNA 与可用的 Rig', () => {
  const bp = normalizeBlueprint(sample())!
  const { dna, rig, matureDay } = compileBlueprint(bp)
  assert.equal(dna.archetype, 'orb')
  assert.equal(dna.name, '测试虫')
  assert.equal(rig.parts.length, 2)
  assert.equal(rig.span, 80)
  assert.equal(matureDay, 24)
  assert.equal(typeof rig.pose, 'function')
})

test('compileBlueprint:确定性(同输入同输出)', () => {
  const a = compileBlueprint(normalizeBlueprint(sample())!)
  const b = compileBlueprint(normalizeBlueprint(sample())!)
  assert.equal(JSON.stringify(a.rig.parts), JSON.stringify(b.rig.parts))
  assert.equal(a.dna.name, b.dna.name)
})

test('compileBlueprint:grow/appear 展开成 0..上限 的单调函数', () => {
  const bp = normalizeBlueprint(
    sample({
      parts: [
        { id: 'a', d: 'M 0 0 L 4 4', role: 'body', z: 1, grow: { from: 0, to: 10, a: 0.5, b: 1 }, appear: { start: 2, end: 6 } },
      ],
    }),
  )!
  const { rig } = compileBlueprint(bp)
  const p = rig.parts[0]
  assert.ok(p.grow && p.appear)
  assert.equal(p.grow!(0), 0.5)
  assert.equal(p.grow!(10), 1)
  assert.ok(p.grow!(5) > p.grow!(2))
  assert.equal(p.appear!(2), 0)
  assert.equal(p.appear!(6), 1)
  assert.equal(p.appear!(99), 1)
})

test('compileBlueprint:pose 返回每帧覆盖量,且幅度有限', () => {
  const bp = normalizeBlueprint(sample())!
  const { rig } = compileBlueprint(bp)
  for (const ts of [0, 0.13, 1.7, 9.9]) {
    const ov = rig.pose({ flapHz: 2.4 }, ts, 5)
    for (const [id, o] of Object.entries(ov)) {
      for (const v of [o.rot, o.x, o.y]) {
        if (v !== undefined) assert.ok(Number.isFinite(v), `${id} 第 ${ts}s 出现非有限值`)
      }
    }
  }
})

test('compileBlueprint:显式 rules 覆盖启发式猜测', () => {
  const bp = normalizeBlueprint(
    sample({
      parts: [{ id: 'wing', d: 'M 0 0 L 6 6', role: 'accent', z: 1 }],
      motionCfg: { family: 'flap', period: 1, amplitude: 1, rules: { wing: { amp: 90, phase: 0 } } },
    }),
  )!
  const { rig } = compileBlueprint(bp)
  const peak = rig.pose({ flapHz: 2.4 }, 0.25, 0) // period=1 → w=π/2 → sin=1
  assert.ok(Math.abs((peak.wing?.rot ?? 0) - 90) < 1e-6, `${peak.wing?.rot}`)
})

test('compileBlueprint:不同运动族给出不同节奏', () => {
  const wing = { id: 'wing', d: 'M 0 0 L 6 6', role: 'accent' as const, z: 1 }
  const flap = compileBlueprint(normalizeBlueprint(sample({ parts: [wing] }))!).rig
  const hop = compileBlueprint(
    normalizeBlueprint(sample({ parts: [wing], motionCfg: { family: 'hop', period: 1.6, amplitude: 1 } }))!,
  ).rig
  const a = flap.pose({ flapHz: 2.4 }, 0.37, 0)
  const b = hop.pose({ flapHz: 2.4 }, 0.37, 0)
  assert.notEqual(JSON.stringify(a), JSON.stringify(b))
})

test('compileBlueprint:缺失/非法 DNA 也能编译出可用骨架(绝不返回空)', () => {
  const bp = normalizeBlueprint(sample({ dna: { name: '', archetype: 'nope', palette: {}, traits: {} } }))
  assert.ok(bp)
  const { dna, rig } = compileBlueprint(bp)
  assert.equal(dna.archetype, 'orb')
  assert.ok(rig.parts.length > 0)
})
