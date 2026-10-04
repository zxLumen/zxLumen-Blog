import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARCHETYPES,
  TRAIT_AXES,
  normalizeDna,
  formAt,
  resolveForm,
  type CreatureDna,
  type TraitAxis,
} from '../dist/creature/spec.js'
import {
  growthAtDay,
  growthOf,
  stageFloatOf,
  totalXp,
  elapsedDays,
  interactXp,
  daysToStage,
  STAGE_XP,
  DAILY_XP,
  INTERACT_XP,
} from '../dist/creature/growth.js'
import { fallbackDna, DEFAULT_DNA, keywordMatch } from '../dist/creature/fallback.js'
import { randomBatch } from '../dist/creature/random.js'
import {
  heuristicScore,
  craftScore,
  rankOf,
  rankScore,
  weightedGeometricMean,
  combineAxes,
  CRAFT_TOTAL,
  APPEAL_TOTAL,
  CRAFT_WEIGHTS,
  APPEAL_WEIGHTS,
  SCORE_KEYS,
  SCORE_DIM_FLOOR,
  AXIS_MIX,
} from '../dist/creature/score.js'
import { leverageOf } from '../dist/creature/leverage.js'
import { diversityOf } from '../dist/creature/diversity.js'
import { rhoOf, distOf, calibrate, deadThreshold, MIN_N_FOR_RHO } from '../dist/creature/calibrate.js'

/* ---------------------------- 夹具 ---------------------------- */

/** 每个原型一段**能被词表认出来**的中文描述(英文名不在词表里,别用) */
const PROTO_DESC: Record<string, string> = {
  butterfly: '彩蝶',
  fish: '游鱼',
  dragon: '蛟龙',
  orb: '光球',
  insect: '甲虫',
  bird: '翠鸟',
  plant: '藤蔓',
  machine: '齿轮装置',
}

/** 成长输入的最小骨架 */
const base = (day: number, interact?: Record<string, { h: number; c: number }>) => ({
  createdAtMs: 0,
  stageXp: 0,
  interact: interact ?? {},
  _day: day,
})

/* ---------------------------- normalizeDna ---------------------------- */

test('normalizeDna 拒绝缺 archetype 的输入(必须走 fallback)', () => {
  assert.equal(normalizeDna(null), null)
  assert.equal(normalizeDna('nope'), null)
  assert.equal(normalizeDna({}), null)
  assert.equal(normalizeDna({ archetype: 'unicorn' }), null)
})

test('normalizeDna 把数字夹到区间、枚举查白名单', () => {
  const d = normalizeDna({
    archetype: 'orb',
    traits: { luminous: 999, ethereal: -50 },
    motion: { flapHz: 1e9, bobPx: -3 },
    shape: { limbPairs: 1e6, symmetry: 5 },
  })!
  assert.equal(d.traits.luminous, 5)
  assert.equal(d.traits.ethereal, 0)
  assert.equal(d.motion.flapHz, 6)
  assert.equal(d.motion.bobPx, 0)
  assert.equal(d.shape.limbPairs, 4)
  assert.equal(d.shape.symmetry, 1)
})

test('normalizeDna 过滤非法颜色,退到站点默认色', () => {
  const d = normalizeDna({
    archetype: 'orb',
    palette: { body: 'red', accent: '#GGGGGG', glow: 'javascript:alert(1)' },
  })!
  for (const c of [d.palette.body, d.palette.accent, d.palette.glow]) {
    assert.match(c, /^#[0-9a-f]{6}$/)
  }
})

test('normalizeDna 截断超长字符串', () => {
  const d = normalizeDna({ archetype: 'orb', name: 'x'.repeat(50) })!
  assert.ok(d.name.length <= 8)
})

test('normalizeDna 总是产出 STAGE_COUNT-1 条 plan', () => {
  assert.equal(normalizeDna({ archetype: 'orb' })!.plan.length, 3)
  assert.equal(normalizeDna({ archetype: 'orb', plan: [{ name: 'a' }] })!.plan.length, 3)
  // 给多了也要截断(MAX_PAN = 3)
  assert.equal(
    normalizeDna({
      archetype: 'orb',
      plan: Array.from({ length: 9 }, (_, i) => ({ stage: i, name: `n${i}` })),
    })!.plan.length,
    3,
  )
})

test('normalizeDna 是幂等的(过一遍和过两遍一样)', () => {
  // 这是"校验器是唯一入口"的前提:下游可以放心反复归一化
  const raw = { archetype: 'orb', traits: { luminous: 99 }, plan: [{ name: 'x', note: '' }] }
  const once = normalizeDna(raw)!
  const twice = normalizeDna(once)!
  assert.deepEqual(once, twice)
})

/* ---------------------------- 形态解算 ---------------------------- */

test('formAt 把阶段夹在 0..3', () => {
  const dna = fallbackDna('一只发光的蝴蝶')
  assert.equal(formAt(dna, -5).stage, 0)
  assert.equal(formAt(dna, 99).stage, 3)
})

test('resolveForm 在阶段之间连续插值(成长不是三次跳变)', () => {
  const dna = fallbackDna('一只发光的蝴蝶')
  const a = resolveForm(dna, 1)
  const mid = resolveForm(dna, 1.5)
  const b = resolveForm(dna, 2)
  assert.ok(mid.size > a.size && mid.size < b.size, `${a.size} < ${mid.size} < ${b.size}`)
  assert.ok(mid.glow > a.glow && mid.glow < b.glow)
})

test('resolveForm 不越界', () => {
  const dna = fallbackDna('x')
  assert.equal(resolveForm(dna, -3).stage, 0)
  assert.ok(resolveForm(dna, 99).size > 0)
})

test('size 随阶段单调不减', () => {
  for (const desc of ['机械甲虫', '发光水母', '远古巨龙', '圆球光团']) {
    const dna = fallbackDna(desc)
    let prev = -1
    for (let s = 0; s <= 3; s += 0.05) {
      const size = resolveForm(dna, s).size
      assert.ok(size >= prev - 1e-6, `${desc} @${s}: ${size} < ${prev}`)
      prev = size
    }
  }
})

test('所有原型都能解算出合法几何', () => {
  for (const [a, desc] of Object.entries(PROTO_DESC)) {
    const dna = fallbackDna(desc, `proto-${a}`)
    assert.equal(dna.archetype, a, `${a} <- "${desc}"`)
    for (let s = 0; s <= 3; s += 0.25) {
      const f = resolveForm(dna, s)
      assert.ok(Number.isFinite(f.size) && f.size > 0)
      assert.ok(f.glow >= 0 && f.glow <= 1)
      assert.ok(f.trail >= 0 && f.trail <= 1)
      assert.ok(f.spin >= 0 && f.spin <= 1)
      assert.ok(f.segments >= 1 && f.segments <= 4)
      assert.ok(f.topTraits.length > 0)
    }
  }
})

test('traits 全部落在 0..8', () => {
  const dna = fallbackDna('一只机械的会发光的小可爱圆球')
  for (const ax of TRAIT_AXES) {
    const v = resolveForm(dna, 3).traits[ax]
    assert.ok(v >= 0 && v <= 8, `${ax}=${v}`)
  }
})

/* ---------------------------- 成长 ---------------------------- */

test('stageFloatOf 在阶段边界处精确落位', () => {
  assert.equal(stageFloatOf(0), 0)
  assert.equal(stageFloatOf(STAGE_XP[1]), 1)
  assert.equal(stageFloatOf(STAGE_XP[2]), 2)
  assert.equal(stageFloatOf(STAGE_XP[3]), 3)
  // 阈值中点应落在该阶段的正中
  const mid = stageFloatOf((STAGE_XP[1] + STAGE_XP[2]) / 2)
  assert.ok(Math.abs(mid - 1.5) < 1e-9, mid)
})

test('满级约需 19 天纯时间(18 XP/天 × 阈值 340)', () => {
  const days = daysToStage(3)
  assert.ok(Math.abs(days - 340 / 18) < 1e-9)
  assert.ok(days > 18 && days < 20, days)
})

test('totalXp:时间按天取整,互动单独计入', () => {
  const day = 86_400_000
  const created = 1_000_000
  const b = { createdAtMs: created, stageXp: 0, interact: {} }
  // 时间经验按 18 XP/天 **连续**累积再取整 —— 不是「跨过零点才算一天」,
  // 否则每天开头会有一小段时间毫无成长(0.9 天却停在昨天的分上)
  assert.equal(totalXp(b, created).timeXp, 0)
  assert.equal(totalXp(b, created + day).timeXp, DAILY_XP)
  assert.equal(totalXp(b, created + 0.5 * day).timeXp, DAILY_XP / 2)
  assert.equal(totalXp(b, created + 10.5 * day).timeXp, Math.floor(10.5 * DAILY_XP))
  // 已结算的互动经验原样计入总账
  const withXp = totalXp({ createdAtMs: created, stageXp: 7, interact: {} }, created)
  assert.equal(withXp.xp, 7)
})

test('互动经验按上限截断,不能刷到满级', () => {
  const tons = { a: { h: 10_000, c: 10_000 } }
  assert.ok(interactXp(tons) < STAGE_XP[3], `${interactXp(tons)}`)
  assert.equal(interactXp(undefined), 0)
})

test('互动经验按访客去重(同一人的重复点击不叠加到上限外)', () => {
  // 一个访客猛点 100 次 vs 12 个访客各点 1 次:后者应更高(去重的意义)
  const spammer = { a: { h: 100, c: 100 } }
  const crowd = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`v${i}`, { h: 1, c: 1 }]),
  )
  assert.ok(interactXp(crowd) >= interactXp(spammer))
})

test('INTERACT_XP.click 比 hover 值钱', () => {
  assert.ok(INTERACT_XP.click > INTERACT_XP.hover)
  assert.ok(interactXp({ a: { h: 1, c: 1 } }) > interactXp({ a: { h: 2, c: 0 } }))
})

test('growthAtDay 产出的阶段随天数单调不减', () => {
  const g = growthAtDay({ createdAtMs: 0, stageXp: 0, interact: {} }, 0)
  let prev = -1
  for (let d = 0; d <= 90; d += 1) {
    const cur = growthAtDay({ createdAtMs: 0, stageXp: 0, interact: {} }, d)
    assert.ok(cur.stage >= prev, `day ${d}: ${cur.stage} < ${prev}`)
    prev = cur.stage
  }
  assert.equal(g.stage, 0)
})

test('growthOf 与 growthAtDay 在整数天上一致', () => {
  const now = 30 * 86_400_000
  const input = { createdAtMs: 0, stageXp: 0, interact: { a: { h: 3, c: 2 } } }
  const viaMs = growthOf(input, now)
  const viaDay = growthAtDay(input, 30)
  assert.equal(viaMs.stage, viaDay.stage)
  assert.equal(viaMs.stageFloat, viaDay.stageFloat)
})

test('互动把阶段往前推(时间为主、互动加速)', () => {
  const t = 10 * 86_400_000
  const none = growthOf({ createdAtMs: 0, stageXp: 0, interact: {} }, t)
  const many = growthOf({ createdAtMs: 0, stageXp: 0, interact: { a: { h: 5, c: 5 } } }, t)
  assert.ok(many.xp > none.xp)
  assert.ok(many.stageFloat >= none.stageFloat)
})

test('elapsedDays 对负时间差夹到 0(时钟回拨不能算出负天数)', () => {
  assert.equal(elapsedDays(1_000_000, 500_000), 0)
  assert.equal(elapsedDays(0, 0), 0)
  assert.ok(elapsedDays(0, 86_400_000) > 0.999)
})

/* ---------------------------- 兜底推导 ---------------------------- */

test('fallbackDna 是确定性的:同描述同结果', () => {
  assert.deepEqual(fallbackDna('一只赛博机械蝴蝶'), fallbackDna('一只赛博机械蝴蝶'))
  assert.notDeepEqual(fallbackDna('a', 'salt1'), fallbackDna('a', 'salt2'))
})

test('fallbackDna 认得词表里的原型', () => {
  assert.equal(fallbackDna('一只蝴蝶').archetype, 'butterfly')
  assert.equal(fallbackDna('深海巨鲸').archetype, 'fish')
  assert.equal(fallbackDna('钢铁机甲').archetype, 'machine')
  assert.equal(fallbackDna('发光的水母').archetype, 'fish')
})

test('fallbackDna 产出的一定是合法 DNA(能过校验器)', () => {
  for (const d of ['', '   ', '???', 'x'.repeat(500), '🔥🔥🔥']) {
    const dna = fallbackDna(d)
    assert.ok(dna, JSON.stringify(d))
    assert.deepEqual(dna, normalizeDna(dna), `非法: ${d}`)
  }
})

test('fallbackDna 不会产出全零特质(否则渲染成一坨死黑)', () => {
  for (const d of ['???', 'zzz', '12345']) {
    const dna = fallbackDna(d)
    assert.ok(
      TRAIT_AXES.some((a) => dna.traits[a] > 0),
      d,
    )
  }
})

test('fallbackDna 恒定带 luminous(任何描述都要能看见)', () => {
  for (const d of ['机械', '石头', '深海']) {
    assert.ok(fallbackDna(d).traits.luminous > 0, d)
  }
})

test('DEFAULT_DNA 能被校验器接受,且归一化幂等', () => {
  // 注意不能直接 deepEqual:归一化会补齐 add 里的缺省键,对象键顺序也不同
  const once = normalizeDna(DEFAULT_DNA)!
  assert.ok(once)
  assert.deepEqual(once, normalizeDna(once))
})

test('keywordMatch:描述与 DNA 越贴合分越高', () => {
  const hit = fallbackDna('一只发光的蝴蝶')
  const miss = fallbackDna('zzz')
  assert.ok(keywordMatch('一只发光的蝴蝶', hit) > keywordMatch('zzz', hit))
  assert.ok(keywordMatch('zzz', miss) < 1)
  assert.equal(keywordMatch('', hit), 0)
})

/* ---------------------------- 打分 ---------------------------- */

test('heuristicScore 分项 0..1、总分 0..100', () => {
  const descr = '一只赛博朋克风格的机械蝴蝶,翅脉里流淌着蓝光'
  const s = heuristicScore(fallbackDna(descr), descr)
  for (const k of SCORE_KEYS) {
    assert.ok(s.dims[k] >= 0 && s.dims[k] <= 1, `${k}=${s.dims[k]}`)
  }
  // 两轴是 0..100 的**真分数**(逐维是 0..1),量纲不同别混
  for (const k of ['craft', 'appeal', 'total'] as const) {
    assert.ok(s[k] >= 0 && s[k] <= 100, `${k}=${s[k]}`)
  }
  // 两轴权重各自成环:不能把 craft 的权重加到 appeal 上(跨轴相加没有意义)
  assert.equal(
    Object.values(CRAFT_WEIGHTS).reduce((a, b) => a + b, 0),
    CRAFT_TOTAL,
  )
  assert.equal(
    Object.values(APPEAL_WEIGHTS).reduce((a, b) => a + b, 0),
    APPEAL_TOTAL,
  )
  assert.deepEqual(Object.keys(CRAFT_WEIGHTS).filter((k) => k in APPEAL_WEIGHTS), [])
})

test('新维度 structure:部件多且角色多样 > 只有一个 body', () => {
  const dna = fallbackDna('一只测试生物')
  const thin = heuristicScore(dna, '一只测试生物', {
    parts: [{ id: 'body', role: 'body' }],
  }).dims.structure
  const rich = heuristicScore(dna, '一只测试生物', {
    parts: [
      { id: 'body', role: 'body' }, { id: 'bodyDark', role: 'bodyDark' },
      { id: 'eye', role: 'eye' }, { id: 'nose', role: 'nose' },
      { id: 'accent', role: 'accent' }, { id: 'glow', role: 'glow' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `accent-${i}`, role: 'accent' })),
    ],
  }).dims.structure
  assert.ok(rich > thin, `部件多的应更高: ${rich} vs ${thin}`)
})

test('新维度 fidelity:「六条腿」要能验出腿数,而不是靠描述长度灌水', () => {
  const dna = fallbackDna('一只测试生物')
  const ctx6 = { parts: Array.from({ length: 6 }, (_, i) => ({ id: `leg-${i + 1}`, role: 'accent' })) }
  const ctx4 = { parts: Array.from({ length: 4 }, (_, i) => ({ id: `leg-${i + 1}`, role: 'accent' })) }
  const ctx0 = { parts: [{ id: 'body', role: 'body' }] }

  const six = heuristicScore(dna, '一只长着六条腿的甲虫', ctx6).dims.fidelity
  const four = heuristicScore(dna, '一只长着六条腿的甲虫', ctx4).dims.fidelity
  const none = heuristicScore(dna, '一只长着六条腿的甲虫', ctx0).dims.fidelity
  assert.equal(six, 1, '6/6 应满分')
  assert.ok(six > four, `腿数对得上应更高:${six} vs ${four}`)
  // 4/6 差 2 条 = 没照做,和 0 条同档(都不是「差一条」的近似)
  assert.equal(four, none, '差一半与完全没腿同档')
  assert.ok(four < six, `照做了应更高:${four} vs ${six}`)
})

test('fidelity 反向长度陷阱:只点 1 类要求时不该比点多类更容易满分', () => {
  const dna = fallbackDna('一只测试生物')
  const ctx = { parts: [{ id: 'body', role: 'body' }, { id: 'glow', role: 'glow' }] }
  // 只提「发光」一项 → 做到即满分(单项不足以说明偷工减料)
  const one = heuristicScore(dna, '一只深海发光水母', ctx).dims.fidelity
  // 提多项且全做到 → 也该满分
  const multiAll = heuristicScore(dna, '一只发光的、蓝色的、有尾巴、会走的东西', {
    ...ctx,
    parts: [...ctx.parts, { id: 'tail', role: 'accent' }],
    motionFamily: 'walk',
  }).dims.fidelity
  assert.equal(one, 1, '单一要求做到即满分')
  assert.equal(multiAll, 1, '多项全做到同样满分')
  // 关键:多项且漏掉 → 必须扣分,否则 rich 档永远追不上稀疏档
  const multiMiss = heuristicScore(dna, '一只发光的、蓝色的、有尾巴、会走的东西', {
    parts: ctx.parts,
    motionFamily: 'glide',
  }).dims.fidelity
  assert.ok(multiMiss < 1, `多项漏掉应扣分:${multiMiss}`)
})

test('fidelity 不被描述长度灌水:没点到任何可验特征的长描述拿中性分', () => {
  const dna = fallbackDna('一只测试生物')
  const ctx = { parts: [{ id: 'body', role: 'body' }, { id: 'eye', role: 'eye' }] }
  // 两段都没有「腿/触须/眼/发光/翼/尾/颜色/动作」这类可验特征
  const a = heuristicScore(dna, '一只安安静静的、很好看的、让人喜欢的小东西', ctx).dims.fidelity
  const b = heuristicScore(dna, '嗯', ctx).dims.fidelity
  assert.equal(a, b, `不该因描述更长而变高:${a} vs ${b}`)
})

test('motion 评自洽而非魔法数:同一 DNA 换 family 会改分,但不因接近某常数得满分', () => {
  const dna = fallbackDna('一只测试生物')
  // idle/breathe 却大幅漂移 = 自相矛盾,应低于自洽组合
  const clash = heuristicScore(dna, '测试', { motionFamily: 'breathe' }).dims.motion
  const calm = heuristicScore(dna, '测试', { motionFamily: 'idle' }).dims.motion
  assert.ok(calm >= clash, `自洽组合应不低:${calm} vs ${clash}`)
  // 高频 + 大幅 = 抽搐,应被扣分
  const frantic = { ...dna, motion: { ...dna.motion, flapHz: 6, driftAmp: 40 } }
  assert.ok(
    heuristicScore(frantic, '测试').dims.motion < heuristicScore(dna, '测试').dims.motion,
    '抽搐参数应低于正常参数',
  )
})

/* ------------------- 分数分布:三个导致「全挤在 70~90」的缺陷 ------------------- */

const traitProfile = (vals: Partial<Record<TraitAxis, number>>) =>
  heuristicScore(
    normalizeDna({ ...fallbackDna('测试'), traits: vals }),
    '测试',
    {},
  ).dims.traits

test('traits 不再把「八轴均匀」当满分 —— 均匀恰恰是没性格', () => {
  const flat = TRAIT_AXES.reduce((a, k) => ({ ...a, [k]: 3 }), {} as Record<TraitAxis, number>)
  const flatScore = traitProfile(flat)
  const cyber = traitProfile({ cyber: 5, luminous: 4 })
  assert.ok(
    cyber > flatScore,
    `明确的赛博朋克(cyber=5+luminous=4)应高于八轴全 3:${cyber} vs ${flatScore}`,
  )
  // 原实现里八轴全 3 拿 0.75 封顶、cyber=5+lum=4 只有 0.150,是完全反的
  assert.ok(cyber > 0.6, `双主角不该被压到低分:${cyber}`)
  assert.ok(flatScore < 0.7, `均匀铺开不该接近满分:${flatScore}`)
})

test('traits 区分「有性格」与「真塌缩」:判据是次高轴的量级,不是非零轴条数', () => {
  const lonely = traitProfile({ cyber: 5 }) // 一根轴拉满,其余真的为 0
  const duo = traitProfile({ cyber: 5, luminous: 4 }) // 双主角,不是塌缩
  const twinFull = traitProfile({ mechanical: 5, organic: 5 }) // 两根轴都满
  assert.ok(duo > lonely, `cyber=5+lum=4 不该与 cyber=5 同分:${duo} vs ${lonely}`)
  // ⚠ 阈值从 0.2 放宽到 0.45:`lonelyPeak` 系数由 0.35 调到 0.45。理由是
  // 「cyber=5 单轴拉满」其实是**很强的**性格表达,不该和「塌缩」同罚;真正的塌缩
  // 由 `peak` 项扣(轴值全在 1 附近 → peak≈0),孤峰只做**成比例**的减分。
  // 关键的不变量是 duo > lonely,以及 lonely 明显低于 0.45。
  assert.ok(lonely < 0.45, `真塌缩应被重罚:${lonely}`)
  assert.ok(twinFull > lonely, `双轴满更不该当塌缩:${twinFull}`)
  // 原实现三者都是 0.150(判据写的是 nonzero <= 2,数的是条数)
})

test('traits 计入量级:「几乎没有气质」不该和中等强度同分', () => {
  const faint = traitProfile({ cyber: 0.6, luminous: 0.4 })
  const solid = traitProfile({ cyber: 3, luminous: 2 })
  const faded = traitProfile(Object.fromEntries(TRAIT_AXES.map((k) => [k, 1])) as Record<
    TraitAxis,
    number
  >)
  const strong = traitProfile(Object.fromEntries(TRAIT_AXES.map((k) => [k, 5])) as Record<
    TraitAxis,
    number
  >)
  // 原实现用熵,只看 v/total,于是 cyber=0.6+lum=0.4 与 cyber=3+lum=2 同分
  assert.ok(faint < solid, `极淡应低于中等强度:${faint} vs ${solid}`)
  assert.ok(faded < strong, `同样铺开八轴,量级大应更高:${faded} vs ${strong}`)
})

test('narrative 在 blueprint 路径不再是常量(plan 为空时改看 parts 的生长窗口)', () => {
  const dna = fallbackDna('测试')
  // 无任何时间信息 → 中性分
  const flat = heuristicScore(dna, '测试', {
    parts: Array.from({ length: 18 }, (_, i) => ({ id: `p${i}`, role: 'body' })),
  }).dims.narrative
  // 分阶段出场 + 一直在长大
  const staged = heuristicScore(dna, '测试', {
    parts: Array.from({ length: 18 }, (_, i) => ({
      id: `p${i}`,
      role: i % 3 ? 'body' : 'accent',
      appear: { start: i * 1.2, end: i * 1.2 + 6 },
      grow: { from: i * 0.8, to: 45 + i * 2, a: 0.5, b: 1 },
    })),
  }).dims.narrative
  // 有 grow 但很早就不长了
  const stunted = heuristicScore(dna, '测试', {
    parts: Array.from({ length: 18 }, (_, i) => ({
      id: `p${i}`,
      role: i % 3 ? 'body' : 'accent',
      appear: { start: i * 0.4, end: i * 0.4 + 4 },
      grow: { from: i * 0.3, to: 10, a: 0.5, b: 1 },
    })),
  }).dims.narrative
  assert.ok(staged > flat, `分阶段成长应高于全同帧冒出来:${staged} vs ${flat}`)
  assert.ok(staged > stunted, `长得久应更高:${staged} vs ${stunted}`)
  // 原实现这条路径恒为 0.49(占 8/94 权重 = 纯常数,是分数收窄的直接成因)
})

test('总分用加权几何平均:单项灾难不再被其余六维平均掉', () => {
  const all = 0.9
  const craftAll = {
    fidelity: all, structure: all, palette: all,
    motion: all, narrative: all, match: all,
  }
  const uniform = weightedGeometricMean(craftAll, CRAFT_WEIGHTS)
  // 只有 fidelity 崩了(craft 轴权重最高 24)
  const oneBad = weightedGeometricMean({ ...craftAll, fidelity: 0.1 }, CRAFT_WEIGHTS)
  // 算术平均下 fidelity 崩到 0.1 时:0.9*74/94 + 0.1*20/94 = 0.73 → 只掉 17 分
  // 几何平均要掉得更多,短板才藏不住
  assert.ok(uniform > 0.89, `全优应接近 1:${uniform}`)
  assert.ok(
    uniform - oneBad > 0.1,
    `单项灾难应显著拉低总分:${uniform} → ${oneBad}`,
  )
  assert.ok(
    oneBad < uniform * (74 / 100 + (0.1 * 24) / 100),
    `几何平均的结果必须低于同权重的算术平均:${oneBad}`,
  )
})

test('几何平均的单维地板:一维归零不会把整只打成 0', () => {
  const base = {
    fidelity: 0.8, structure: 0.8, palette: 0.8,
    motion: 0.8, narrative: 0.8, match: 0.8,
  }
  const zeroed = weightedGeometricMean({ ...base, match: 0 }, CRAFT_WEIGHTS)
  assert.ok(zeroed > 0, '不能归零')
  // 地板 0.08:权重最小的 match 归零,其余六维的 0.8 把它拉到 ~0.66(不是 0)
  assert.ok(zeroed > 0.5, `一维归零后其余维度仍应撑住大部分分:${zeroed}`)
  // 高权重维度归零才应该明显掉 —— 权重越大,短板越痛
  const fidZero = weightedGeometricMean({ ...base, fidelity: 0 }, CRAFT_WEIGHTS)
  assert.ok(fidZero < zeroed, `fidelity(craft 权重 24)归零应比 match(10)更痛:${fidZero} vs ${zeroed}`)
  assert.ok(fidZero > 0.3, `但也不该被打到接近 0:${fidZero}`)
})

test('地板取值不会把低权重维度压成常数(否则等于换了种方式制造死重)', () => {
  // 0.15 时 match 有 44% 样本被兜到同一个值;这里确认地板足够低
  const base = {
    fidelity: 0.8, structure: 0.8, palette: 0.8,
    motion: 0.8, narrative: 0.8, match: 0.8,
  }
  const a = weightedGeometricMean({ ...base, match: 0.2 }, CRAFT_WEIGHTS)
  const b = weightedGeometricMean({ ...base, match: 0.3 }, CRAFT_WEIGHTS)
  assert.ok(b > a, `地板以下仍应保留区分度:${a} → ${b}`)
  assert.ok(SCORE_DIM_FLOOR <= 0.1, `地板 ${SCORE_DIM_FLOOR} 偏大会吃掉低权重维度的信号`)
})

test('craftScore:无 judge 采样时退化为纯启发分(模型不可用不能阻塞)', () => {  assert.equal(craftScore(50, []), 50)
  assert.equal(craftScore(0, []), 0)
  assert.equal(craftScore(100, []), 100)
})

test('craftScore:judge 权重 0.55,heur 权重 0.45', () => {
  assert.equal(craftScore(0, [100]), 55)
  assert.equal(craftScore(100, [0]), 45)
  assert.equal(craftScore(80, [80]), 80) // 两者一致时结果不变
})

test('craftScore 对异常采样值夹到 0..100', () => {
  assert.ok(craftScore(50, [1e9]) >= 0 && craftScore(50, [1e9]) <= 100)
  assert.ok(craftScore(50, [-1e9]) >= 0 && craftScore(50, [-1e9]) <= 100)
})

test('rankScore:新作品有新鲜度优势,但衰减是缓变而非线性归零', () => {
  const now = rankScore(80, 50, 0)
  const old = rankScore(80, 50, 300)
  assert.ok(now > old, '新作品应有一小段优势')
  // 衰减 = (1 + age/10) ** 0.35:300 天约剩三成,而不是趋近 0
  assert.ok(old > 0.15, `衰减过猛: ${old}`)
  assert.ok(old < now * 0.5, `300 天后应明显靠后: ${old} vs ${now}`)
})

test('rankScore 对年龄单调递减', () => {
  let prev = Infinity
  for (const age of [0, 1, 7, 30, 90, 365, 3650]) {
    const v = rankScore(70, 60, age)
    assert.ok(v < prev, `age ${age}: ${v} 应小于上一档`)
    prev = v
  }
})

test('rankScore 单调:分数更高、热度更高 → 排名分越高', () => {
  // 注意 heat 口径是 **0..1**(由 heatOf 产出),不是 0..100
  assert.ok(rankScore(90, 0.5, 0) > rankScore(60, 0.5, 0), 'craft')
  assert.ok(rankScore(80, 0.9, 0) > rankScore(80, 0.1, 0), 'heat')
  // 越界输入夹到有效区间,不该产生 NaN 或反向
  assert.ok(rankScore(1e9, 1e9, 0) >= rankScore(1e9, 1e9, 0))
  assert.ok(Number.isFinite(rankScore(-5, -5, -5)))
})

test('rankOf 排序确定:同分按 id 兜底稳定,不随输入顺序抖', () => {
  const mk = (id: string, craft: number) => ({
    id,
    craft,
    ageDays: 0,
    uniqViewers: 0,
    uniqHovers: 0,
    uniqClicks: 0,
  })
  const list = [mk('a', 60), mk('b', 90), mk('c', 75)]
  const r1 = rankOf(list).map((x) => x.id)
  const r2 = rankOf([...list].reverse()).map((x) => x.id)
  assert.deepEqual(r1, r2, '输入顺序不该影响名次')
  assert.deepEqual(r1, ['b', 'c', 'a'])
})

test('rankOf 的 rank 字段是排名分(不是名次序号)', () => {
  const mk = (id: string, craft: number) => ({
    id,
    craft,
    ageDays: 0,
    uniqViewers: 0,
    uniqHovers: 0,
    uniqClicks: 0,
  })
  const r = rankOf([mk('a', 60), mk('b', 90), mk('c', 75)])
  // 降序排列,且各行 rank 等于自己那套公式算出来的分
  assert.ok(r[0].rank >= r[1].rank && r[1].rank >= r[2].rank)
  assert.equal(r[0].rank, rankScore(90, 0, 0))
})

test('rankOf 空表不炸', () => {
  assert.deepEqual(rankOf([]), [])
})

/* ---------------------------- 端到端 ---------------------------- */

test('端到端:描述 → DNA → 60 天 → 形态,全程有限且合法', () => {
  const dna: CreatureDna = fallbackDna('深海中发光的巨型水母,触手像数据流一样飘动')
  for (let day = 0; day <= 60; day++) {
    const g = growthAtDay({ createdAtMs: 0, interact: {} }, day)
    const f = resolveForm(dna, g.stageFloat)
    assert.ok(Number.isFinite(f.size) && f.size > 0, `day ${day}`)
    assert.ok(f.size <= 200, `day ${day} size=${f.size}`) // 别炸到画布外
    for (const c of [f.palette.body, f.palette.accent, f.palette.glow]) {
      assert.match(c, /^#[0-9a-f]{6}$/)
    }
  }
})
/* --------------------- 结构化随机描述(校验样本源) --------------------- */

test('随机批次:同种子必出同一批(调权重时才能复跑对比)', () => {
  const a = randomBatch(12, 4242)
  const b = randomBatch(12, 4242)
  assert.deepEqual(
    a.items.map((i) => i.descr),
    b.items.map((i) => i.descr),
  )
  assert.equal(a.seed, 4242)
})

test('随机批次:换种子应换题(否则「换一批」没意义)', () => {
  const a = randomBatch(30, 1)
  const b = randomBatch(30, 2)
  assert.notDeepEqual(
    a.items.map((i) => i.descr),
    b.items.map((i) => i.descr),
  )
})

test('随机批次:三档丰富度数量大致相等,否则均值没法跨档比', () => {
  const items = randomBatch(30, 7).items
  const count = (d: string) => items.filter((i) => i.density === d).length
  assert.equal(count('sparse'), 10)
  assert.equal(count('medium'), 10)
  assert.equal(count('rich'), 10)
})

test('随机批次:描述按丰富度递增变长,且 rich 档五项料齐全', () => {
  const items = randomBatch(30, 7).items
  const sparse = items.filter((i) => i.density === 'sparse')
  const medium = items.filter((i) => i.density === 'medium')
  const rich = items.filter((i) => i.density === 'rich')
  const avg = (xs: string[]) => xs.reduce((n, s) => n + s.length, 0) / xs.length
  assert.ok(avg(sparse.map((i) => i.descr)) < avg(medium.map((i) => i.descr)), 'sparse 应短于 medium')
  assert.ok(avg(medium.map((i) => i.descr)) < avg(rich.map((i) => i.descr)), 'medium 应短于 rich')
  // rich 档埋的料要能对上评分关心的点:双色、辉光、两个特质、动态、怪癖
  for (const it of rich) {
    assert.ok(it.descr.includes(';'), `rich 缺分段: ${it.descr}`)
    assert.ok(it.descr.split(';').length >= 4, `rich 料不够: ${it.descr}`)
  }
})

test('随机批次:批内描述不重复,id 从 1 连续', () => {
  const items = randomBatch(30, 99).items
  assert.equal(new Set(items.map((i) => i.descr)).size, items.length)
  assert.deepEqual(
    items.map((i) => i.id),
    Array.from({ length: 30 }, (_, k) => k + 1),
  )
})

test('随机批次:同组三档共用一个原型(丰富度才是唯一自变量)', () => {
  const items = randomBatch(30, 7).items
  for (let g = 0; g < 10; g++) {
    const triple = items.slice(g * 3, g * 3 + 3)
    assert.deepEqual(
      triple.map((t) => t.density),
      ['sparse', 'medium', 'rich'],
    )
    // 主体词在组内三档里都要出现:稀疏档「一只X」、中等档「…的X,」、丰富档「…的X,…」
    const body = triple[0].descr.replace(/^一只/, '')
    assert.ok(triple[1].descr.includes(body), `组 ${g} 中等档丢了原型: ${triple[1].descr}`)
    assert.ok(triple[2].descr.includes(body), `组 ${g} 丰富档丢了原型: ${triple[2].descr}`)
  }
})

test('随机批次:原型不放回取样,相邻组不会撞同一个主体', () => {
  const items = randomBatch(30, 5).items
  const bodies = items.map((i) => i.descr.replace(/^一只/, '').split(/[、,;]/)[0])
  const sparse = items.filter((i) => i.density === 'sparse').map((i) => i.descr)
  assert.equal(new Set(sparse).size, sparse.length, 'sparse 档原型应互不相同')
  assert.equal(new Set(bodies.slice(0, 12)).size > 1, true)
})

/* ---------------------------- P1:气质轴落实 ---------------------------- */

test('P1 气质轴:描述点名「赛博」而 cyber 轴没亮 → 落实度扣分,点亮后不再扣', () => {
  const cold = normalizeDna(fallbackDna('测试'))
  const lit = normalizeDna({ ...fallbackDna('测试'), traits: { ...cold.traits, cyber: 4 } })

  // 只点气质词,不点任何物理特征(无触须/腿/眼/发光/翼/尾/颜色/动作),
  // 这样分母就只有「赛博」一项,能干净地验证单项分支。
  // ⚠ 别在这句里加「霓虹」等颜色词 —— 会额外命中「配色」那一项,把分母变成 2。
  const descr = '一只赛博朋克电子造物'
  const a = heuristicScore(cold, descr, {}).dims.fidelity
  const b = heuristicScore(lit, descr, {}).dims.fidelity
  assert.ok(a < b, `cyber 轴点亮后应提分:${a} → ${b}`)
  assert.equal(a, 0.4, '轴为 0 是彻底没兑现,走单项未达成的 0.4')
  assert.equal(b, 1)
})

test('P1 气质轴:备注里能看到是哪根轴没亮', () => {
  const cold = normalizeDna(fallbackDna('测试'))
  const s = heuristicScore(cold, '一只赛博朋克电子造物', {})
  assert.deepEqual(s.fidelityNotes, ['✗赛博(0)'])
})

test('P1 气质轴:轴值 1 记半亮(~),不按「没做到」也不按「照做」', () => {
  const base = normalizeDna(fallbackDna('测试'))
  const half = normalizeDna({ ...base, traits: { ...base.traits, cyber: 1 } })
  const s = heuristicScore(half, '一只赛博朋克电子造物', {})
  assert.deepEqual(s.fidelityNotes, ['~赛博(1)'])
  // 半亮算「做到了」这一支(≥0.5),单项分支不给 0.4
  assert.equal(s.dims.fidelity, 1)
})

test('P1 气质轴:通用字不算气质词(否则「一只小东西」会被判成点名了可爱)', () => {
  const dna = normalizeDna(fallbackDna('测试'))
  const ctx = { parts: [{ id: 'body', role: 'body' }] }
  // 与既有测试同款:都不该触发任何可验特征 → 中性 0.55
  const a = heuristicScore(dna, '一只安安静静的、很好看的、让人喜欢的小东西', ctx).dims.fidelity
  const b = heuristicScore(dna, '嗯', ctx).dims.fidelity
  assert.equal(a, 0.55)
  assert.equal(b, 0.55)
  assert.deepEqual(heuristicScore(dna, '一只安安静静的、很好看的、让人喜欢的小东西', ctx).fidelityNotes, [])
})

test('P1 气质轴:发光不重复计票(luminous 归第 4 项管,不进气质轴)', () => {
  const dark = normalizeDna(fallbackDna('测试'))
  // 只写「发光」这一个词:应当只有「发光」一项,不能再多出一条 luminous 轴
  const s = heuristicScore(dark, '一只发光的灯', { parts: [{ id: 'glow', role: 'glow' }] })
  assert.deepEqual(s.fidelityNotes, ['✓发光'])
})

/* ---------------------------- P0-1:多样性 / 新颖度 ---------------------------- */

test('P0-1 一批完全相同的 DNA → 新颖度趋 0、覆盖率趋 0、diversity 为 0', () => {
  const one = normalizeDna(fallbackDna('齿轮装置'))
  const same = Array.from({ length: 8 }, () => normalizeDna(one))
  const r = diversityOf(same)
  assert.equal(r.meanNovelty, 0, '最近邻距离为 0 → 平均新颖度 0')
  assert.equal(r.diversity, 0, '没有任何一对达到距离阈值')
  assert.equal(r.occupied, 1, '只占满一个格子')
  assert.ok(r.closest, '应报出最挤的一对')
  assert.equal(r.closest!.dist, 0)
  assert.ok(r.perItem.every((p) => p.nn === 0))
})

test('P0-1 换原型/换色相/换形态 → 距离变大、新颖度上升、coverage 上升', () => {
  const a = normalizeDna(fallbackDna('齿轮装置'))
  const mixed = [
    a,
    normalizeDna({ ...a, archetype: 'dragon', palette: { body: '#ff3366', accent: '#00ffcc', glow: '#ffee00' } }),
    normalizeDna({ ...a, archetype: 'bird', palette: { body: '#2244ff', accent: '#ffffff', glow: '#ff0000' }, shape: { limbPairs: 2, spineSegments: 12, symmetry: 0.1 } }),
    normalizeDna({ ...a, archetype: 'plant', palette: { body: '#228833', accent: '#88ff22', glow: '#004400' }, shape: { limbPairs: 4, spineSegments: 3, symmetry: 1 } }),
  ]
  const r = diversityOf(mixed)
  const flat = diversityOf(Array.from({ length: 4 }, () => normalizeDna(a)))
  assert.ok(r.meanNovelty > flat.meanNovelty, `应有更高新颖度:${r.meanNovelty} vs ${flat.meanNovelty}`)
  assert.ok(r.diversity > flat.diversity, `应有更高 diversity:${r.diversity} vs ${flat.diversity}`)
  assert.ok(r.occupied > flat.occupied, '应占用更多格子')
})

test('P0-1 用最近邻而不是均值:一半雷同 + 一半孤点时,雷同那批的新颖度必须低', () => {
  const base = normalizeDna(fallbackDna('齿轮装置'))
  // 3 个雷同 + 3 个彼此很远
  const batch = [
    base,
    normalizeDna(base),
    normalizeDna(base),
    normalizeDna({ ...base, archetype: 'dragon', palette: { body: '#ff0000', accent: '#00ff00', glow: '#0000ff' } }),
    normalizeDna({ ...base, archetype: 'orb', palette: { body: '#ffff00', accent: '#ff00ff', glow: '#00ffff' } }),
    normalizeDna({ ...base, archetype: 'plant', palette: { body: '#00ff88', accent: '#8800ff', glow: '#ffffff' } }),
  ]
  const r = diversityOf(batch)
  const twins = r.perItem.slice(0, 3).map((p) => p.novelty)
  assert.ok(twins.every((v) => v < 0.3), `雷同的三只新颖度应都很低:${twins}`)
  // 雷同那三只互相是最近邻(下标互指),孤点彼此不相邻
  assert.deepEqual(r.perItem.slice(0, 3).map((p) => p.nnIdx), [1, 0, 0])
})

test('P0-1 dims 直接指出「哪一维整批没在变」', () => {
  const base = normalizeDna(fallbackDna('齿轮装置'))
  const bodies = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']
  // 只换主体色相,原型 / 特质 / 动效 / 形状全同
  const batch = bodies.map((body) => normalizeDna({ ...base, palette: { ...base.palette, body } }))
  const r = diversityOf(batch)
  const motion = r.dims.find((d) => d.key === 'motion')!
  const hue = r.dims.find((d) => d.key === 'hue')!
  // 离散度是连续量,判 0 要给容差:六个相同浮点数求均值的舍入会留下 ~1e-17 的残差
  assert.ok(motion.spread < 1e-12, `动效没改 → 离散度应≈0,实为 ${motion.spread}`)
  assert.ok(hue.spread > 0.1, `色相改了 → 离散度应明显大于 0,实为 ${hue.spread}`)
})

test('P0-1 边界:空批不炸;单只没有邻居可比(nn=null)', () => {
  const empty = diversityOf([])
  assert.deepEqual(empty.perItem, [])
  assert.equal(empty.meanNovelty, 0)
  assert.equal(empty.closest, null)

  const one = diversityOf([normalizeDna(fallbackDna('齿轮装置'))])
  assert.equal(one.perItem.length, 1)
  assert.equal(one.perItem[0]!.nn, null)
  assert.equal(one.perItem[0]!.nnIdx, -1)
  assert.equal(one.diversity, 0, '没有可比较的对')
})

/* ---------------------------- P0-2:逐维相关性 ---------------------------- */

test('P0-2 Spearman:完全同序 = 1,完全逆序 = -1', () => {
  assert.equal(rhoOf([1, 2, 3, 4, 5, 6, 7, 8], [10, 20, 30, 40, 50, 60, 70, 80]), 1)
  assert.equal(rhoOf([1, 2, 3, 4, 5, 6, 7, 8], [80, 70, 60, 50, 40, 30, 20, 10]), -1)
})

test('P0-2 Spearman:并列取平均秩,常数序列无定义 → null', () => {
  // 一侧全同值(全打「棒」)→ 没有方差,不该报 0
  assert.equal(rhoOf([1, 2, 3, 4, 5, 6, 7, 8], [2, 2, 2, 2, 2, 2, 2, 2]), null)
  assert.equal(rhoOf([5, 5, 5, 5, 5, 5, 5, 5], [1, 2, 3, 4, 5, 6, 7, 8]), null)
})

test('P0-2 Spearman:样本不足不报数(宁可不报也不报假结论)', () => {
  assert.equal(rhoOf([1, 2, 3], [3, 2, 1]), null)
  const n = MIN_N_FOR_RHO
  assert.notEqual(rhoOf(Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => i)), null)
  assert.equal(rhoOf(Array.from({ length: n - 1 }, (_, i) => i), Array.from({ length: n - 1 }, (_, i) => i)), null)
})

test('P0-2 Spearman:对单调非线性变换不变(秩相关的意义)', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const ys = [1, 4, 9, 16, 25, 36, 49, 64, 81] // 平方,严格单调
  assert.equal(rhoOf(xs, ys), 1)
})

test('P0-2 calibrate:逐维拆出「权重大但在划水」的维', () => {
  const n = 12
  const mk = (rating: number, fidelity: number) => ({
    score: {
      // 逐维一律放 `dims`;顶层只留两轴 + 总分
      dims: Object.fromEntries([
        ['palette', 0.5], ['traits', 0.5], ['motion', 0.5],
        ['narrative', 0.63], ['match', 0.5], ['structure', 0.5],
        ['fidelity', fidelity],
        ['silhouette', 0.5], ['face', 0.5], ['colorPop', 0.5], ['motionRich', 0.5],
      ]) as never,
      craft: fidelity * 100,
      appeal: 50,
      total: fidelity * 100,
    },
    rating,
  })
  // 前 4 只评「差」、中 4 只「还行」、后 4 只「棒」;fidelity 单调跟随
  const rows = Array.from({ length: n }, (_, i) => mk(i < 4 ? 0 : i < 8 ? 1 : 2, i / (n - 1)))

  const c = calibrate(rows)
  assert.equal(c.n, n)
  assert.equal(c.enough, true)
  // 不是 1:12 条里评价只有三个档(4/4/4),并列取平均秩得 2.5/6.5/10.5,
  // 而 fidelity 是 12 个互不相同的值(秩 1..12)—— 两侧秩向量不完全相同,ρ 略小于 1。
  const fid = c.perDim.find((d) => d.key === 'fidelity')!
  assert.ok(fid.rho! > 0.94, `fidelity 与评价应高度同序,实为 ${fid.rho}`)
  assert.equal(c.perDim.find((d) => d.key === 'narrative')!.rho, null, '常数维无方差 → null 而不是 0')
  assert.equal(c.total.rho, fid.rho, 'total 就等于 fidelity 的序列')
  // 每一维都要有分布,且 fidelity 的中位数应落在批内中段
  assert.ok(c.perDim.every((d) => d.dist), '每维都要报分布')
  assert.ok(c.total.dist!.median > 0 && c.total.dist!.median < 100)
})

test('P0-2 calibrate:评价无并列时同序才是严格的 1', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    score: {
      dims: Object.fromEntries([
        ['palette', 0.5], ['traits', 0.5], ['motion', 0.5], ['narrative', 0.5],
        ['match', 0.5], ['structure', 0.5], ['fidelity', i / 7],
        ['silhouette', 0.5], ['face', 0.5], ['colorPop', 0.5], ['motionRich', 0.5],
      ]) as never,
      craft: (i / 7) * 100,
      appeal: 50,
      total: (i / 7) * 100,
    },
    // 8 个互不相同的评价,没有并列
    rating: i,
  }))
  const c = calibrate(rows)
  assert.equal(c.perDim.find((d) => d.key === 'fidelity')!.rho, 1)
})

test('P0-2 calibrate:deadWeight 只收「ρ 测得出但接近 0」的维,不含 null', () => {
  const n = 10
  const rows = Array.from({ length: n }, (_, i) => ({
    score: {
      dims: Object.fromEntries([
        // 与评价无关的锯齿 → ρ≈0
        ['palette', i % 2 === 0 ? 0.9 : 0.1],
        ['traits', 0.5],
        ['motion', 0.5],
        ['narrative', 0.63], // 常数 → null
        ['match', 0.5],
        ['structure', 0.5],
        ['fidelity', 0.5],
        ['silhouette', 0.5],
        ['face', 0.5],
        ['colorPop', 0.5],
        ['motionRich', 0.5],
      ]) as never,
      craft: 50,
      appeal: 50,
      total: (i / (n - 1)) * 100,
    },
    rating: i % 3,
  }))
  const c = calibrate(rows)
  const keys = c.deadWeight.map((d) => d.key)
  assert.ok(keys.includes('palette'), 'ρ≈0 的 palette 应进 deadWeight')
  assert.ok(!keys.includes('narrative'), 'null(无方差)不该算 deadWeight —— 那不是死重是没测出来')
  assert.equal(c.deadWeight.length, keys.length)
})

test('P0-2 dist:报分布而不是只报均值(均值会把双峰抹平)', () => {
  const bimodal = distOf([10, 10, 10, 90, 90, 90])!
  assert.equal(bimodal.avg, 50)
  assert.equal(bimodal.median, 50)
  assert.ok(bimodal.p25 < bimodal.p75, '双峰样本四分位距应很宽')
  assert.equal(distOf([]), null)
})

/* ---------------------------- 回归:色相换算 ---------------------------- */

test('回归 色相换算:三个分支的 /6 必须包住整个分子(照抄 rgbToHsl 时漏过括号)', () => {
  // 三支主色各自的代表色,期望落在标准色相上
  const cases: [string, number][] = [
    ['#ff0000', 0], // 红
    ['#00ff00', 120], // 绿 —— 正是漏括号那支
    ['#0000ff', 240], // 蓝 —— 漏括号的另一支
    ['#ffff00', 60], // 黄
    ['#00ffff', 180], // 青
    ['#ff00ff', 300], // 品红
  ]
  for (const [hex, want] of cases) {
    const base = normalizeDna(fallbackDna('测试'))
    const a = diversityOf([normalizeDna({ ...base, palette: { ...base.palette, body: hex } })])
    const b = diversityOf([
      normalizeDna({ ...base, palette: { ...base.palette, body: hex } }),
      normalizeDna({ ...base, palette: { ...base.palette, body: hex } }),
    ])
    // 用「两个同色样本的色相直方图落在第几桶」反推色相,避免直接导出内部函数
    const binA = a.hueHistogram.findIndex((v) => v > 0)
    const binB = b.hueHistogram.findIndex((v) => v > 0)
    assert.ok(binA >= 0 && binB >= 0, `${hex} 应落进某个色相桶`)
    // 色相应落在正确的那一桶:桶宽 30°,四舍五入到最近桶
    const expect = Math.round(want / 30) % 12
    assert.equal(binA, expect, `${hex} 期望桶 ${expect},实为 ${binA}`)
  }
})

test('回归 色相离散度不可能超过 1(负色相/越界色相会撑破这个上界)', () => {
  const base = normalizeDna(fallbackDna('测试'))
  const bodies = ['#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#008000', '#000080', '#00fa00', '#0000fa']
  const batch = bodies.map((body) => normalizeDna({ ...base, palette: { ...base.palette, body } }))
  const r = diversityOf(batch)
  const hue = r.dims.find((d) => d.key === 'hue')!
  // 色相已归一到 [0,360],除以 180 后是 [0,2] → 总体标准差的理论上界是 1
  assert.ok(hue.spread <= 1, `色相离散度应 ≤1,实为 ${hue.spread}`)
  // 直方图不能因为负下标漏到数组之外(负下标会让 sum 不等于批内总数)
  assert.equal(r.hueHistogram.reduce((a, b) => a + b, 0), batch.length, '直方图计数应等于批内总数')
})

/* ---------------------------- 回归:死重判定线 ---------------------------- */

test('回归 死重判定线随样本量变,不是固定 0.2', () => {
  assert.ok(Math.abs(deadThreshold(30) - 1.96 / Math.sqrt(27)) < 1e-9)
  // 样本越少,线越高 —— n=10 时 0.2 会把真有信号的问成死重
  assert.ok(deadThreshold(10) > deadThreshold(30))
  assert.ok(deadThreshold(8) > deadThreshold(20))
  // 封顶 1:|ρ| 不可能超过 1,所以 n=4 时整条线顶到 1 = 什么都判死重
  assert.equal(deadThreshold(3), 1, '样本太少时直接全判死重')
  assert.equal(deadThreshold(4), 1, '1.96/√1 被封顶到 1')
  assert.ok(Math.abs(deadThreshold(30) - 1.96 / Math.sqrt(27)) < 1e-9)
})

test('回归 n=30 时 |ρ|=0.30 不算死重:旧的固定 0.2 线会冤枉它', () => {
  const cut = deadThreshold(30)
  // 这正是这次改动要修的错误:固定 0.2 落在零相关的置信带(±0.36)里面,
  // 于是 0.30 这样的**有信号**的维也会被标成「死重」,而 0.2 听上去又很合理。
  const rho = 0.3
  assert.ok(0.2 < rho, '前提:旧的固定 0.2 线确实在 0.30 之下(所以旧线会把它误判成死重)')
  assert.ok(Math.abs(rho) < cut, `前提:n=30 的判定线 ${cut.toFixed(3)} 应在 0.30 之上(所以新线不会误判)`)
  // 再看一眼 n=10 的反面:同一份数据在 n=10 时就该判成死重了(线更高)
  assert.ok(Math.abs(rho) < deadThreshold(10), '同一 |ρ| 在样本更少时应被判成死重')
})

/* ------------------- 拆两轴 + 去偏:这一版的核心 ------------------- */

test('两轴:逐维全 1 时两轴都满分,total 由 combineAxes 合成', () => {
  // 把 11 维全喂 1.0(不走 heuristicScore,直接测合成层)
  const craft = weightedGeometricMean(
    Object.fromEntries(Object.keys(CRAFT_WEIGHTS).map((k) => [k, 1])),
    CRAFT_WEIGHTS,
  )
  const appeal = weightedGeometricMean(
    Object.fromEntries(Object.keys(APPEAL_WEIGHTS).map((k) => [k, 1])),
    APPEAL_WEIGHTS,
  )
  assert.ok(craft > 0.999 && appeal > 0.999)
  assert.ok(combineAxes(craft, appeal) > 0.999)
  // 轴的权重是**各自成环**的:craft 的 100 分不该被 appeal 稀释成 50
  assert.equal(AXIS_MIX.craft + AXIS_MIX.appeal, 1)
})

test('两轴能互相拆开:同一份 DNA,craft 高而 appeal 低是可能的', () => {
  const dna = fallbackDna('一只长着六条腿的甲虫')
  // 不给 parts → silhouette / face 退回中性 0.55;motionRules 空 → motionRich 低
  const s = heuristicScore(dna, '一只长着六条腿的甲虫')
  assert.ok(s.craft > 0 && s.appeal > 0)
  // 顶层不再有逐维字段,免得「score.palette」和「score.dims.palette」两处同名不同义
  assert.equal((s as unknown as Record<string, unknown>).palette, undefined)
  assert.equal((s as unknown as Record<string, unknown>).traits, undefined)
})

test('听读(match)改成精确率:点亮更多轴不再自动拿高分 —— 「克制但照做」应高于「全亮但没在听」', () => {
  const restrained = heuristicScore(
    normalizeDna({ ...fallbackDna('测试'), traits: { cyber: 3 } }),
    '一只赛博朋克风格的东西',
  )
  const shotgun = heuristicScore(
    normalizeDna({
      ...fallbackDna('测试'),
      traits: { cyber: 3, cute: 3, cool: 3, fierce: 3, luminous: 3, organic: 3 },
    }),
    '一只赛博朋克风格的东西',
  )
  assert.ok(
    restrained.dims.match > shotgun.dims.match,
    `描述只点名赛博,那就把 cyber 点亮就该更高:${restrained.dims.match} vs ${shotgun.dims.match}`,
  )
  // 旧实现是反的:`traitHit.length / 4` 数的是「命中了几根轴」,全亮必胜
})

test('听读(match)不再有描述长度效应:同样照做,长短描述同分', () => {
  const dna = normalizeDna({ ...fallbackDna('测试'), traits: { cyber: 3 } })
  const short = heuristicScore(dna, '赛博朋克')
  const long = heuristicScore(dna, '赛博朋克风格的一个小东西,带一点点的机械感')
  assert.ok(
    Math.abs(short.dims.match - long.dims.match) < 0.25,
    `长度效应应大幅减弱:${short.dims.match} vs ${long.dims.match}`,
  )
})

test('撞色(colorPop)有下限:全灰的配色拿 0.2 而不是 0', () => {
  const grey = heuristicScore(normalizeDna({
    ...fallbackDna('测试'),
    palette: { body: '#808080', accent: '#7f7f7f', glow: '#818181' },
  }))
  const vivid = heuristicScore(normalizeDna({
    ...fallbackDna('测试'),
    palette: { body: '#ff2d95', accent: '#00e5ff', glow: '#fff200' },
  }))
  assert.ok(grey.dims.colorPop >= 0.19, `灰暗不该归零:${grey.dims.colorPop}`)
  assert.ok(vivid.dims.colorPop > grey.dims.colorPop + 0.3)
})

test('剪影:挤在中心的一团 应低于 铺开但不出画布的一群', () => {
  const dna = fallbackDna('测试')
  const bunched = heuristicScore(dna, '测试', {
    span: 100,
    parts: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, role: 'body', x: i % 2 ? 1 : -1, y: 0, d: 'M0 0 '.repeat(20) })),
  })
  const spread = heuristicScore(dna, '测试', {
    span: 100,
    parts: Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`, role: 'body',
      x: Math.cos((i / 20) * Math.PI * 2) * 45, y: Math.sin((i / 20) * Math.PI * 2) * 45,
      d: 'M0 0 '.repeat(4 + (i % 5) * 8),
    })),
  })
  assert.ok(spread.dims.silhouette > bunched.dims.silhouette,
    `${spread.dims.silhouette} vs ${bunched.dims.silhouette}`)
})

test('动势(motionRich):多个不同节奏 优于 全体同频', () => {
  const dna = fallbackDna('测试')
  const unison = heuristicScore(dna, '测试', {
    motionRules: Array.from({ length: 6 }, () => ({ amp: 20, periodScale: 1 })),
  })
  const layered = heuristicScore(dna, '测试', {
    motionRules: [
      { amp: 6, periodScale: 1 },
      { amp: 14, periodScale: 0.6 },
      { amp: 22, periodScale: 1.4 },
      { amp: 30, periodScale: 0.85 },
      { amp: 38, periodScale: 1.15 },
    ],
  })
  assert.ok(layered.dims.motionRich > unison.dims.motionRich + 0.15,
    `${layered.dims.motionRich} vs ${unison.dims.motionRich}`)
})

test('leverage:能指出「权重大但在划水」的死重维', () => {
  // 11 维里只有两维在动,其余全是常数 → 常数维必然是死重
  const rows = Array.from({ length: 30 }, (_, i) => {
    const v = i / 29
    return heuristicScore(
      normalizeDna({ ...fallbackDna('测试'), traits: { cyber: 1 + (i % 5) } }),
      '测试',
    ) && {
      craft: v * 100,
      appeal: (1 - v) * 100,
      total: 50 + v * 10,
      dims: Object.fromEntries(SCORE_KEYS.map((k) => [k, k === 'match' ? v : k === 'traits' ? 1 - v : 0.5])) as never,
    }
  })
  const rep = leverageOf(rows)
  assert.equal(rep.perDim.length, SCORE_KEYS.length)
  const dead = rep.dead.map((r) => r.key)
  assert.ok(dead.length > 0, '常数维应被判死重')
  assert.ok(!dead.includes('match'), '唯一真正在变的维不该被判死重')
  assert.ok(!dead.includes('traits'), '另一维在反向变化,也不该死重')
  // 每个轴内的权重份额之和为 1
  for (const ax of ['craft', 'appeal'] as const) {
    const sum = rep.perDim.filter((r) => r.axis === ax).reduce((a, r) => a + r.weightShare, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9, `${ax} 轴权重份额应和为 1,实为 ${sum}`)
  }
})
