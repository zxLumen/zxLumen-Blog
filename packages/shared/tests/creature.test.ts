import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARCHETYPES,
  TRAIT_AXES,
  normalizeDna,
  formAt,
  resolveForm,
  type CreatureDna,
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
import { heuristicScore, craftScore, rankOf, rankScore, WEIGHT_TOTAL } from '../dist/creature/score.js'

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
  for (const k of ['palette', 'traits', 'motion', 'narrative', 'match'] as const) {
    assert.ok(s[k] >= 0 && s[k] <= 1, `${k}=${s[k]}`)
  }
  assert.ok(s.total >= 0 && s.total <= 100, s.total)
})

test('craftScore:无 judge 采样时退化为纯启发分(模型不可用不能阻塞)', () => {
  assert.equal(craftScore(50, []), 50)
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
