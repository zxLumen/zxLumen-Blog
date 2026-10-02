/**
 * 确定性打分(`heur`):对 DNA 本身做客观工艺检查,免费、可复现、零抖动。
 *
 * 为什么要它:LLM 评判(`judge`)必然有噪声、有压缩偏差、会抽风。这条管线在**不调模型**
 * 的前提下给出一个稳定的下界,并且和 `judge` 互补 ——
 *  - `heur` 擅长「配色是不是一坨」「动效参数是不是没动/乱闪」「三段成长是不是雷同」
 *    这些**可计算**的问题;
 *  - `judge` 擅长「像不像访客要的那个东西」「独特吗」「成长叙事有无看头」这些
 *    必须理解语义的问题。
 *
 * 所有分项与权重都导出,便于日后调参;排名在读取时算,原始分入库,所以改权重零成本。
 */

import { TRAIT_AXES, type CreatureDna } from './spec.js'
import { keywordMatch } from './fallback.js'

export const WEIGHTS = {
  palette: 25,
  traits: 20,
  motion: 20,
  narrative: 20,
  match: 15,
} as const

export const WEIGHT_TOTAL = WEIGHTS.palette + WEIGHTS.traits + WEIGHTS.motion + WEIGHTS.narrative + WEIGHTS.match

/* ---------------------------- 颜色工具 ---------------------------- */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16)
  if (!Number.isFinite(n)) return [128, 128, 128]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h * 360, s, l]
}

const hsl = (hex: string) => {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHsl(r, g, b)
}

/** 相对亮度(WCAG) */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度 1..21 */
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 色相夹角距离 0..180 */
function hueDist(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360
  return d > 180 ? 360 - d : d
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const norm = (n: number) => clamp01(n)

/* ---------------------------- 五项检查 ---------------------------- */

/**
 * 配色和谐 0..1
 *
 * 看三件事:色相是不是「设计过」(类比/互补/三角)、饱和度有没有层次、
 * 主体与辉光/点缀是否分得开。**不与页面背景比** —— DNA 不知道当前主题,
 * 那是渲染器读 `var(--accent)` 的事。
 */
function scorePalette(dna: CreatureDna): number {
  const { body, accent, glow } = dna.palette
  const [bh, bs, bl] = hsl(body)
  const [, as_, al] = hsl(accent)
  const [, gs, gl] = hsl(glow)

  // 色相和谐:三色中若存在一组落在类比(<45°)/三角(~120°)/互补(~180°)带内即算「成谱」
  const hues = [bh, hsl(accent)[0], hsl(glow)[0]]
  let harmony = 0.25
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const d = hueDist(hues[i], hues[j])
      const near =
        Math.min(Math.abs(d - 180), Math.abs(d - 120), Math.min(d, 45)) // 互补/三角/类比
      const fit = Math.max(0, 1 - near / 45)
      harmony = Math.max(harmony, fit)
    }
  }
  // 三色同 hue 不同明度也算「单色系」,是合法的设计选择,给一个中位分
  const allSame = hues.every((h) => hueDist(h, bh) < 12)
  if (allSame) harmony = Math.max(harmony, 0.5)

  // 饱和度层次:全 0 是死灰,全 1 是塑料,中间最好
  const sats = [bs, as_, gs]
  const satSpread = Math.max(...sats) - Math.min(...sats)
  const satLevel = norm(1 - Math.abs(Math.max(...sats) - 0.7) / 0.6)
  const satScore = 0.5 * norm(satSpread / 0.35) + 0.5 * satLevel

  // 主体与辉光/点缀要分得开(否则糊成一坨)
  const sepGlow = norm((contrast(body, glow) - 1.05) / 0.9)
  const sepAccent = norm((contrast(body, accent) - 1.02) / 0.7)
  const sepScore = 0.5 * sepGlow + 0.5 * sepAccent

  // 主体不能太暗或太淡,否则在两种主题下都看不清
  const bodyLevel = norm(1 - Math.abs(bl - 0.6) / 0.5)

  return 0.34 * harmony + 0.24 * satScore + 0.28 * sepScore + 0.14 * bodyLevel
}

/**
 * 特质均衡 0..1
 *
 * 熵(别全挤在一根轴)+ 非零轴数 + 「一轴拉满其余为 0」的惩罚。
 * 一只只有 mechanical=5 的生物和一只六轴均衡的生物,后者明显更有看头。
 */
function scoreTraits(dna: CreatureDna): number {
  const vals = TRAIT_AXES.map((a) => dna.traits[a])
  const total = vals.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  const entropy = -vals.reduce((acc, v) => {
    if (v === 0) return acc
    const p = v / total
    return acc + p * Math.log(p)
  }, 0)
  const hNorm = entropy / Math.log(TRAIT_AXES.length)

  const nonzero = vals.filter((v) => v > 0).length
  const max = Math.max(...vals)

  const spread = 0.45 * hNorm + 0.3 * norm(nonzero / 4)
  // 一根轴到 5 而别的近乎为 0 → 退化,重罚
  const degenerate = max >= 5 && nonzero <= 2 ? 0 : max >= 4 && nonzero <= 2 ? 0.4 : 1
  return clamp01(spread * degenerate + (1 - degenerate) * 0.15)
}

/**
 * 动效可读 0..1
 *
 * 参数落在「能看出在动、又不会乱」的区间中心最好。**过慢比过快扣得更狠**:
 * 慢到看不出动等于白做,快到 6Hz 以上既难看又有频闪风险。
 */
function scoreMotion(dna: CreatureDna): number {
  const m = dna.motion
  const centered = (x: number, c: number, lo: number, hi: number) =>
    clamp01(1 - Math.abs(x - c) / (x < c ? lo : hi))

  const freq = centered(m.flapHz, 3, 2.0, 3.5)
  const drift = centered(m.driftAmp, 20, 14, 20)
  const trail = centered(m.trail, 0.35, 0.3, 0.5)
  const bob = centered(m.bobPx, 5, 5, 8)
  // 自旋是加分项,不是必需项 —— 中等最好,0 也不该重罚
  const spin = clamp01(1 - Math.abs(m.spin - 0.25) / 0.6)

  return 0.34 * freq + 0.28 * drift + 0.16 * trail + 0.12 * bob + 0.1 * spin
}

/** 归一化编辑距离(两字符串差异度 0..1) */
function editSim(a: string, b: string): number {
  if (!a || !b) return 0
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  const dist = dp[m][n]
  return 1 - dist / Math.max(m, n)
}

/**
 * 成长叙事 0..1
 *
 * 三段成长必须「看得出是三个阶段」。全同的 note / 雷同的 boost / 不递增的尺寸
 * 会让 19 天的成长变成「什么都没发生」,这是最该被抓出来的失败模式。
 */
function scoreNarrative(dna: CreatureDna): number {
  const notes = dna.plan.map((p) => p.note)
  const names = dna.plan.map((p) => p.name)

  // 相邻两段 note 的差异度,取最小值(最雷同的那一对说了算)
  let minNoteSim = 1
  for (let i = 0; i + 1 < notes.length; i++) {
    minNoteSim = Math.min(minNoteSim, editSim(notes[i], notes[i + 1]))
  }
  const noteScore = norm((0.62 - minNoteSim) / 0.5)

  // 三段 boost 的键集合要分化
  const keySets = dna.plan.map((p) => Object.keys(p.boost).sort().join('|'))
  const distinct = new Set(keySets).size
  const boostScore = norm((distinct - 1) / 2)

  // 尺寸必须单调不减且末段大于 0(真的有变大)
  let mono = true
  for (let i = 0; i < dna.plan.length; i++) {
    const s = dna.plan[i].add.size ?? 0
    if (s < 0) mono = false
    if (i > 0 && s < (dna.plan[i - 1].add.size ?? 0)) mono = false
  }
  const grew = (dna.plan[dna.plan.length - 1]?.add.size ?? 0) > 0
  const sizeScore = mono && grew ? 1 : mono ? 0.5 : 0

  const nameScore = new Set(names).size === names.length ? 1 : 0.4

  return 0.36 * noteScore + 0.24 * boostScore + 0.26 * sizeScore + 0.14 * nameScore
}

/**
 * 原型契合 0..1 —— 描述与 DNA 的词面重合。
 *
 * 用与 `fallbackDna` 同一套词表,所以「程序推导」天然高分,LLM 生成的高分说明它
 * 真的把描述里的词用上了。确定性指标做不到语义理解,但能抓住「原型选错」这种硬伤。
 */
function scoreMatch(dna: CreatureDna, descr: string): number {
  return keywordMatch(descr, dna)
}

/* ---------------------------- 对外 ---------------------------- */

export interface ScoreBreakdown {
  palette: number
  traits: number
  motion: number
  narrative: number
  match: number
  /** 0..100 */
  total: number
}

/** 对一份合法 DNA 打分;分项均为 0..1 */
export function heuristicScore(dna: CreatureDna, descr = ''): ScoreBreakdown {
  const palette = scorePalette(dna)
  const traits = scoreTraits(dna)
  const motion = scoreMotion(dna)
  const narrative = scoreNarrative(dna)
  const match = descr.trim() ? scoreMatch(dna, descr) : 0.5
  const total =
    (palette * WEIGHTS.palette +
      traits * WEIGHTS.traits +
      motion * WEIGHTS.motion +
      narrative * WEIGHTS.narrative +
      match * WEIGHTS.match) /
    WEIGHT_TOTAL
  return {
    palette: round3(palette),
    traits: round3(traits),
    motion: round3(motion),
    narrative: round3(narrative),
    match: round3(match),
    total: round3(total * 100),
  }
}

/**
 * 作品分 `craft` = 0.45×heur + 0.55×judge,两者都在 0..100。
 *
 * `judgeSample` 为空(judge 未开启 / 调用失败)时退化为纯 heur —— **打分链路绝不
 * 因为模型不可用而阻塞创建**。
 */
export function craftScore(heur: number, judgeSamples: readonly number[]): number {
  const h = clamp01((Number(heur) || 0) / 100)
  if (!judgeSamples.length) return round3(h * 100)
  const j = clamp01(judgeSamples.reduce((a, b) => a + b, 0) / judgeSamples.length / 100)
  return round3((0.45 * h + 0.55 * j) * 100)
}

/* ---------------------------- 排名 ---------------------------- */

/** 人气分 0..1。饱和曲线:刷曝光上不去,只有「不同的人真的停下来」才推分。 */
export function heatOf(uniqViewers: number, uniqHovers: number, uniqClicks: number): number {
  const v = Math.max(0, uniqViewers | 0)
  const h = Math.max(0, uniqHovers | 0)
  const c = Math.max(0, uniqClicks | 0)
  return round3(1 - Math.exp(-(2 * v + 3 * h + 6 * c) / 20))
}

/**
 * 排名分(读取时算,不落库)。
 *
 * 作品分主导但不能一票否决(系数区间 0.55~1.0),人气分次之,时间衰减让新生物
 * 有机会上位 —— 榜单会轮换,但不会因为「今天新鲜」就把丑的顶上去。
 */
export function rankScore(craft: number, heat: number, ageDays: number): number {
  const c = clamp01((Number(craft) || 0) / 100)
  const h = clamp01(Number(heat) || 0)
  const age = Math.max(0, Number(ageDays) || 0)
  const quality = 0.55 + 0.45 * c
  const popularity = 0.55 + 0.45 * h
  const decay = (1 + age / 10) ** 0.35
  return round3((quality * popularity) / decay)
}

/** 排名项:读出来即可排序的最小集合 */
export interface RankedCreature {
  id: string
  craft: number
  heat: number
  ageDays: number
  rank: number
}

export function rankOf(
  rows: readonly { id: string; craft: number; ageDays: number; uniqViewers: number; uniqHovers: number; uniqClicks: number }[],
): RankedCreature[] {
  return rows
    .map((r) => {
      const heat = heatOf(r.uniqViewers, r.uniqHovers, r.uniqClicks)
      return { id: r.id, craft: r.craft, heat, ageDays: r.ageDays, rank: rankScore(r.craft, heat, r.ageDays) }
    })
    .sort((a, b) => b.rank - a.rank)
}

function round3(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0
}
