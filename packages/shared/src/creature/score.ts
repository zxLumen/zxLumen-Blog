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

import { TRAIT_AXES, TRAIT_LABELS, type CreatureDna } from './spec.js'
import { keywordMatch } from './fallback.js'

/**
 * 权重。
 *
 * 重新分配的依据是 `/lab/score` 上实测的「丰富度提升」(同原型三档,rich 减 sparse):
 * 原来 5 维里 `palette/traits/motion` 三维(共 65 分)**只看 DNA、不看描述**,
 * 所以它们对「描述写得细不细」没有任何反应 —— 实测提升分别是 −0.1 / +0.6 / +0.4,
 * 基本是噪声。把权重往「看得见描述」的方向挪:
 *
 *  - `fidelity`(新,20):唯一直接回答「你有没有听我说话」的一维,而且只在描述
 *    真的点了某类特征时才计入那类,不会被描述长度灌水。
 *  - `structure`(新,15):实测 12 部件和 27 部件的生物分数几乎一样 ——
 *    原来没有一维在看「搭得认不认真」。
 *  - `narrative` 20 → 8:实测它把三段雷同和完全不同的 note 都打 0.63,
 *    区分不出任何东西,**降权但保留**(它对非 blueprint 的 DNA 路径仍然有效)。
 *  - `match` 15 → 8:它有长度效应(描述越长关键词越多越容易命中),
 *    在 rich 档天然占便宜;职责交给 `fidelity` 后降为辅助信号。
 *  - `palette/traits` 是纯确定性工艺检查(真色彩数学、熵与退化检测),
 *    换任何模型都不会失效,保留较高权重。
 */
export const WEIGHTS = {
  palette: 18,
  traits: 12,
  motion: 13,
  narrative: 8,
  match: 8,
  structure: 15,
  fidelity: 20,
} as const

export const WEIGHT_TOTAL =
  WEIGHTS.palette +
  WEIGHTS.traits +
  WEIGHTS.motion +
  WEIGHTS.narrative +
  WEIGHTS.match +
  WEIGHTS.structure +
  WEIGHTS.fidelity

/**
 * 单维地板。
 *
 * 几何平均里任何一维趋 0 都会把整个乘积拖到 0(`traits` 全 0、`match` 完全不命中
 * 都会这样),于是「一项不及格」变成「整只归零」,比线性平均严苛得多、也更容易
 * 变成噪声。实测约 16% 的样本存在某维 < 0.05,不设地板会被这批样本整体压死。
 *
 * 0.08 的含义:一维可以明确地差(拿到 0.08),但不足以单独宣判整只生物的死刑。
 * 取值不能更高 —— 地板定 0.15 时实测 `match`(权重仅 8/94)有 **44%** 的样本被
 * 抬到同一个值,等于把这一维重新变成常数、抵消几何平均的区分度。地板只该保护
 * 高权重维度不被一击归零:fidelity(权重 20)归零时总分降到 58%,而 match 归零
 * 只降到 96%,和它的权重相称。
 */
export const SCORE_DIM_FLOOR = 0.08

/**
 * 加权几何平均,返回 0..1。
 *
 * 为什么不用加权算术平均:**算术平均会让「单项灾难」被其余六维平均掉**。
 * 一只配色糟糕、结构潦草、动效抽搐的生物,只要 traits/narrative 还在线,
 * 算术平均照样能拿 70+ —— 这正是实测「所有生物都挤在 70~90」的成因。
 *
 * 几何平均在 log 空间是线性的,等价于「任一维掉下去都会等比地拉低总分」,
 * 短板无法被掩盖。随机 DNA 空间 20000 次抽样:
 * 算术平均四分位距 8.4 / 变异系数 0.089,几何平均 11.3 / 0.270(3 倍区分度)。
 *
 * 配 `SCORE_DIM_FLOOR` 一起用:地板保证不会归零,几何平均保证短板不被掩盖。
 */
export function weightedGeometricMean(parts: Record<ScoreKey, number>): number {
  let sum = 0
  for (const k of SCORE_KEYS) {
    const w = WEIGHTS[k] / WEIGHT_TOTAL
    sum += w * Math.log(Math.max(parts[k], SCORE_DIM_FLOOR))
  }
  return clamp01(Math.exp(sum))
}

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
 * 特质**性格鲜明度** 0..1
 *
 * 原实现是「熵 + 非零轴数 + 退化惩罚」,实测判反了两处:
 *
 *  1. **均匀 = 满分。** `hNorm` 和 `nonzero/4` 都由「八轴铺开」拉满,所以
 *     八轴全 3(彻底没性格)和 cyber=5+luminous=4(明确的赛博朋克)分差极大,
 *     前者反而更高。这一维当时不但没区分度,还在反向惩罚有性格的设计。
 *  2. **只看比例,丢弃量级。** 熵算的是 `v/total`,所以 cyber=0.6+luminous=0.4
 *     这种「几乎没有气质」的生物和 cyber=3+luminous=2 同分。
 *  3. **退化判据用错了量。** 注释写「一根轴到 5 而别的近乎为 0」,代码判的却是
 *     `nonzero <= 2`(非零轴的**条数**)—— 于是 cyber=5+luminous=4 这种双主角
 *     被当成单轴塌缩,和 cyber=5 其余全 0 一起压到 0.15。
 *
 * 改成评「有没有性格」,三项都只看绝对量级:
 *  - **主导轴明确**(leadShare):最强轴占总量的比重。太平均=没主张,太集中=塌缩,
 *    中间那段(约 0.25~0.55)才是「有主次」;单轴独大由 peakShare 单独扣。
 *  - **有支撑**(support):次强轴的量级。这就是原注释想表达的「别全挤在一根轴」,
 *    但判的是量级而不是条数 —— cyber=5+lum=4 因此能拿高分。
 *  - **量级够**(intensity):整体总水平,恢复被熵丢掉的绝对强度信息。
 */
function scoreTraits(dna: CreatureDna): number {
  const vals = TRAIT_AXES.map((a) => dna.traits[a])
  const total = vals.reduce((a, b) => a + b, 0)
  if (total === 0) return 0

  const sorted = [...vals].sort((a, b) => b - a)
  const lead = sorted[0]
  const second = sorted[1] ?? 0

  // 主导轴占比落在「有主次」的甜点区给满分;铺得太开(→0)或太独揽(→1)都扣
  const leadShare = lead / total
  const distinct = norm((leadShare - 0.16) / 0.2) * norm((0.62 - leadShare) / 0.16)

  // 次强轴的量级 = 有没有第二根轴在支撑(双主角不算塌缩)
  const support = norm(second / 2)

  // 整体量级:避免 cyber=0.6/lum=0.4 这种「几乎没有气质」蹭到和中等强度同分
  const intensity = norm(total / 12)

  // 单轴独大且次轴几乎为零:真塌缩,重罚(这是唯一保留的硬惩罚)
  const lonelyPeak = lead >= 4 && second <= 0.5
  const base = 0.34 * distinct + 0.32 * support + 0.34 * intensity
  if (lonelyPeak) return clamp01(base * 0.35)
  return clamp01(base)
}

/**
 * 动效可读 0..1
 *
 * 参数落在「能看出在动、又不会乱」的区间中心最好。**过慢比过快扣得更狠**:
 * 慢到看不出动等于白做,快到 6Hz 以上既难看又有频闪风险。
 */
/**
 * **动效**。
 *
 * 原来这里是「离目标值近不近」:`flapHz` 离 3 近给满分、`bobPx` 离 5 近给满分……
 * 问题是那些目标值全是**拍脑袋定的** —— 模型给 `flapHz=2.4` 会被扣分,给 3.0 就满分,
 * 可「2.4Hz 是不是不好看」没有任何依据。实测这一维对描述丰富度的提升是 +0.4,
 * 基本等于噪声:它压根没在衡量任何和描述有关的东西。
 *
 * 改成评**自洽性**:一组动效参数之间该不该有关联。比如身体晃得越厉害,尾鳍摆幅
 * 通常越大;整体要「活」就得有变化,但变化又不能是抽搐(频率和振幅不能同时爆表)。
 * 这些关系不依赖任何具体的数值目标,所以换个模型也不会失效。
 */
function scoreMotion(dna: CreatureDna, ctx: ScoreContext = {}): number {
  const m = dna.motion

  // 1) 活力:不能完全不动。三个通道取最高,鼓励至少有一处明显在动。
  const activity = clamp01(Math.max(m.flapHz / 6, m.driftAmp / 40, m.bobPx / 12))

  // 2) 不要抽搐:频率与振幅同时到顶 = 高频大幅 = 视觉噪声
  const frantic = m.flapHz >= 5.5 && m.driftAmp >= 30 ? 1 - clamp01((m.flapHz * m.driftAmp) / 220) : 1

  // 3) 通道间要自洽:晃得越厉害,尾鳍/漂移摆幅不该是 0(反之,整体静止时摆尾反而怪)
  const coherence = m.bobPx >= 4 && m.driftAmp < 4 ? 0.35 : m.driftAmp >= 10 && m.bobPx >= 6 ? 0.75 : 1

  // 4) 拖尾要跟得上:动得快却没有拖尾 = 糊;动得慢却拖尾很长 = 脏
  const trailFit = m.trail <= 0 ? 0.6 : 1 - clamp01(Math.abs(m.trail - (0.15 + m.driftAmp / 90)) / 0.5)

  // 5) 有 blueprint 时看 family:和 DNA 的振幅量级是否匹配
  //    (idle/breathe 配大幅摆动是矛盾的;flap/glide 配零飘移也是)
  let familyFit = 0.8
  const fam = ctx.motionFamily
  if (fam) {
    const still = fam === 'idle' || fam === 'breathe'
    familyFit = still && (m.driftAmp >= 20 || m.flapHz >= 5) ? 0.4 : 1
  }

  return clamp01(
    (0.3 * activity + 0.18 * frantic + 0.2 * coherence + 0.2 * trailFit + 0.12 * familyFit) * 1.06,
  )
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
 *
 * **blueprint 路径的 plan 是空的**(`compileBlueprint` 只把成长放在每个 part 的
 * `appear`/`grow` 上),所以走 parts 分支:直接看「出场窗口是否分阶段」。
 * 否则这一维在所有 blueprint 上都恒为同一个值,等于 8 分权重全在测噪声。
 */
function scoreNarrative(dna: CreatureDna, ctx: ScoreContext = {}): number {
  const parts = ctx.parts
  if (parts?.length) return scoreNarrativeFromParts(parts)

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
 * blueprint 的成长叙事:看 parts 的出场/生长窗口有没有真的分阶段。
 *
 * 原来 blueprint 路径下 plan 为空,这里恒等于 0.49(占 8/94 ≈ 8.5% 权重),
 * 是「分数全挤在 70~90」的直接成因之一。现在评三件真实的事:
 *  1. **出场有先后**:部件的出场时点要拉开,不是所有零件同一帧冒出来;
 *  2. **有东西在长大**:至少一部分带 `grow` 窗口(不然 19 天里它根本不变大);
 *  3. **节奏铺得开**:成长窗口不能全挤在头几天,要一直长到后面。
 */
function scoreNarrativeFromParts(parts: readonly { role?: string; grow?: unknown; appear?: unknown }[]): number {
  const starts: number[] = []
  const ends: number[] = []
  let growing = 0

  for (const p of parts) {
    const ap = p.appear as { start?: number; end?: number } | undefined
    if (ap && typeof ap.start === 'number') {
      starts.push(ap.start)
      if (typeof ap.end === 'number') ends.push(ap.end)
    }
    const g = p.grow as { from?: number; to?: number } | undefined
    if (g && typeof g.from === 'number') {
      starts.push(g.from)
      if (typeof g.to === 'number') ends.push(g.to)
    }
    if (g) growing++
  }

  // 没有时间信息就无从评成长叙事,给中性分而不是编一个
  if (starts.length < 2) return 0.5

  const sMin = Math.min(...starts)
  const sMax = Math.max(...starts)
  const eMax = Math.max(...ends, sMax)

  // 1) 出场时点要拉开:全部同帧冒出来 = 0
  const span = sMax - sMin
  const staged = norm(span / 25)

  // 2) 得真的有东西在长大
  const growScore = norm(growing / Math.max(4, parts.length * 0.35))

  // 3) 成长要铺得开:最晚的那个窗口不能太早结束(20 天内一直在变)
  const reachScore = norm(eMax / 40)

  return 0.4 * staged + 0.32 * growScore + 0.28 * reachScore
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

/* ---------------------------- 新增:结构 ---------------------------- */

/**
 * **结构复杂度**:这只东西搭得认不认真。
 *
 * 为什么单列一维:原来 5 维全在评「材质与参数」(配色/特质/动效/文案/关键词),
 * **没有一维在看搭得像不像回事**。实测里 12 部件和 27 部件的生物分数几乎一样
 * —— 也就是说「随便给个圆身子加两条线」和「认真搭了 27 个零件」在评分里等价。
 *
 * 有 `parts` 时(走 blueprint 管线)看真实部件;没有就退回 DNA 的 `shape.plan`,
 * 信息少但不为 0,不会因为老调用点缺上下文而整体掉分。
 */
function scoreStructure(dna: CreatureDna, ctx: ScoreContext): number {
  const parts = ctx.parts
  if (parts?.length) {
    const n = parts.length
    // 部件数:12~26 是「认真搭了」的区间,过少潦草、过多堆料。
    // 用平滑曲线而非硬阈值,免得 12 和 13 差出一个悬崖。
    const ideal = 18
    const countScore = n >= 10 && n <= 30 ? norm(1 - Math.abs(n - ideal) / 26) : norm(n / 10) * 0.5

    // 角色多样性:光靠 body 堆 20 个零件没有意义,得有眼/嘴/纹样等分工
    const roles = new Set(parts.map((p) => p.role ?? ''))
    const roleScore = norm(Math.min(roles.size, 6) / 6)

    // 可动部件占比:全静态的生物再好看也是一张图
    const movable = parts.filter((p) => p.role === 'accent' || p.role === 'accentLight' || p.role === 'line').length
    const motionScore = norm(movable / Math.max(4, n * 0.22))

    // 骨架完整度:不能全是 body —— 主体占比过高压
    const bodyRatio = parts.filter((p) => p.role === 'body').length / n
    const balanceScore = bodyRatio > 0.75 ? 1 - (bodyRatio - 0.75) * 3 : 1

    return clamp01(0.4 * countScore + 0.28 * roleScore + 0.18 * motionScore + 0.14 * balanceScore)
  }

  // 无 parts:退回 DNA 的形状提示(老调用点)。
  // shape 只有 limbPairs / spineSegments / symmetry 三项,信息远少于真实部件树,
  // 所以这里只判「有没有把身体结构说清楚」,给一个窄区间、不制造虚假区分度。
  const s = dna.shape
  const hinted = s ? s.limbPairs * 2 + s.spineSegments : 0
  if (!hinted) return 0.55
  const segScore = norm(s!.spineSegments / 8)
  const limbScore = norm(s!.limbPairs / 4)
  const symScore = norm(1 - Math.abs(s!.symmetry - 0.9) / 0.9)
  return clamp01(0.4 + 0.25 * (0.4 * segScore + 0.35 * limbScore + 0.25 * symScore))
}

/* ---------------------------- 新增:落实度 ---------------------------- */

/**
 * **描述落实度**:描述里点名的东西,有多少真的**长在身上**。
 *
 * 这是整个评分里唯一直接回答「你有没有听我说话」的一维,也是补 `match` 缺口的正解。
 *
 * 与 `keywordMatch` 的关键区别 —— 别把这两个混为一谈:
 *  - `keywordMatch` 问「描述里的词,DNA 里有对应属性吗」,于是**描述越长命中越多**,
 *    稀疏描述天然吃亏。它拿 +2.1/2.9 的「丰富度提升」,几乎全是这个长度效应。
 *  - 这一维问「描述里点名的**每类特征**,生成了对应的部件/动效吗」,并且
 *    **只在描述真的点了某类特征时才计那类**。没提触须不会因为没长触须而扣分;
 *    提了三类特征就按三类算命中率。所以它既不会被长度灌水,也能分辨「照做了」与「没照做」。
 */
function scoreFidelity(
  dna: CreatureDna,
  descr: string,
  ctx: ScoreContext,
): { v: number; notes: string[] } {
  const text = descr.trim()
  if (!text) return { v: 0.5, notes: [] }

  /**
   * 各类特征:描述里出现了才进入分母,避免「没提」被算成「没做到」。
   * `w` 是达成度 0..1(不是布尔):「气质轴半亮」这种中间态要能表达。
   */
  const checks: { w: number; note: string }[] = []
  const hit = (ok: boolean, note: string) => checks.push({ w: ok ? 1 : 0, note })

  // 1) 触须/触手/角/鳍 —— 有没有细长末梢部件
  if (/触须|触手|触角|鹿角|龙角|触|须/.test(text)) {
    const has = ctx.parts?.some(
      (p) => /触|须|角|antenna|tentacle|horn|fin/i.test(`${p.id ?? ''}${p.role ?? ''}`),
    )
    hit(has ?? false, '触须/角')
  }
  // 2) 腿/足 —— 腿的条数是否与描述一致(「六条腿」这种硬要求必须能验)
  if (/条腿|腿|足|爪|蹄/.test(text)) {
    const legs = countLimbs(ctx, LIMB_RE)
    const want = NUM_CN_TO_N[text.match(/([一二三四五六七八九十两\d]+)\s*(?:条腿|只脚|只足|条足|对足)/)?.[1] ?? '']
    // 描述给了具体条数就精确比对,只说「有腿」则只看存不存在。
    // 差一条不算失败(模型数错很正常),差一半才算没照做。
    const legHit = want ? legs === want || Math.abs(legs - want) === 1 : legs > 0
    hit(legHit, `腿(${legs}${want ? `/${want}` : ''})`)
  }
  // 3) 眼 —— 有没有眼部件
  if (/眼|睛|瞳/.test(text)) {
    hit(
      (ctx.parts?.some((p) => /眼|eye/i.test(`${p.id ?? ''}${p.role ?? ''}`)) ?? false) || dna.traits.luminous > 0,
      '眼',
    )
  }
  // 4) 发光/辉光 —— 要么有 glow 部件,要么 luminous 特质够高
  if (/发光|辉光|光|亮|荧|闪/.test(text)) {
    const glowPart = ctx.parts?.some((p) => p.role === 'glow' || /glow|光/i.test(p.id ?? ''))
    hit(!!glowPart || dna.traits.luminous >= 3, '发光')
  }
  // 5) 翼/翅 —— 飞行动效或翼部件
  if (/翼|翅|飞/.test(text)) {
    const wing = ctx.parts?.some((p) => /翼|翅|wing/i.test(`${p.id ?? ''}${p.role ?? ''}`))
    hit(!!wing || ctx.motionFamily === 'flap' || ctx.motionFamily === 'glide', '翼')
  }
  // 6) 尾 —— 尾巴部件
  if (/尾/.test(text)) {
    hit(ctx.parts?.some((p) => /尾|tail/i.test(`${p.id ?? ''}${p.role ?? ''}`)) ?? false, '尾')
  }
  // 7) 描述点名了颜色 —— 配色里是否真的带上了那个色相
  if (/[青蓝绿金银紫橙白黑粉红霓虹]/.test(text)) {
    hit(paletteEchoesColor(dna, text), '配色')
  }
  // 8) 描述给了动作(游/爬/跳/飞/摆) —— 动效 family 是否对得上
  const fam = ctx.motionFamily
  if (fam) {
    const wantSwim = /游|泳|滑/.test(text)
    const wantCrawl = /爬|走|行|迈|步/.test(text)
    const wantHop = /跳|跃|蹦/.test(text)
    if (wantSwim) hit(fam === 'swim', '游')
    if (wantCrawl) hit(fam === 'walk', '走')
    if (wantHop) hit(fam === 'hop', '跳')
  }

  /* 9) **气质轴**:描述点名的性格词,对应的特质轴有没有真的被点亮。
   *
   * 补的是上面 1~8 全都盖不住的洞:它们逐项查的都是**看得见的物理特征**(有触须吗、
   * 腿数对吗、发光吗),而「赛博朋克 / 可爱 / 凶猛 / 远古」这类**气质词**既不长在
   * 部件上也不体现在动作里 —— 它唯一的载体就是那八条特质轴。
   *
   * ⚠ 别把这当成「VQA」自我评价:模型没被问到「你觉得自己赛博吗」,所以不存在
   * 循环论证。检查的是**词表 → 轴**这条确定性映射有没有被兑现 —— 描述点了 cyber,
   * 模型却把 cyber 轴留在 0,是真实且高频的失败模式(模型理解到了氛围,但没落到
   * 任何一个可渲染的字段上)。
   *
   * 真正的「看图说话」得让视觉模型看渲染结果,那是另一条更贵的管线;这一维是
   * 免费、确定性、可复现的下界,并且能直接指出是哪根轴没亮。
   *
   * `luminous` 排除在外:它已经被第 4 项(发光部件/glow)覆盖,重复计入会让
   * 「发光」在分母里占两票。
   */
  for (const axis of TRAIT_AXES) {
    if (axis === 'luminous') continue
    const words = VIBE_WORDS[axis]
    if (!words?.some((w) => text.includes(w))) continue
    const v = dna.traits[axis] ?? 0
    // 轴值 0..5:≥2 算照做(占量程 40%),=1 算半亮,=0 是彻底没兑现
    const w = v >= 2 ? 1 : v === 1 ? 0.5 : 0
    checks.push({ w, note: `${TRAIT_LABELS[axis]}(${v})` })
  }

  // 描述里没点到任何可验证的特征 —— 不奖不罚,给中性
  if (!checks.length) return { v: 0.55, notes: [] }

  /**
   * ⚠ 这里有个**长度效应的镜像坑**,踩过一次:
   * 分母 = 「描述点了哪几类可验特征」。于是描述越具体,可验项越多、越容易漏,
   * 稀疏描述反而占便宜 —— 这是 `match` 那个长度效应的翻版,只是方向相反。
   * 实测就撞上过:稀疏档「一只深海发光水母」只命中「发光」1 项,轻松拿满分;
   * 丰富档点了「翼/尾/配色/走」4 项,漏一项就掉到 0.78。
   *
   * 解法不是把分母改成常数(那等于放弃「有没有照做」这个判断),而是**只在描述
   * 点到 ≥2 类时才严格计数**:单一要求做到就是满分,不足以说明模型偷工减料;
   * 而当描述提了多项要求时,漏掉就该扣 —— 那正是 rich 档该被认出来的地方。
   */
  if (checks.length === 1) {
    const only = checks[0]!
    return { v: only.w >= 0.5 ? 1 : 0.4, notes: [noteOf(only)] }
  }

  const got = checks.reduce((a, c) => a + c.w, 0)
  // 全中给满分;漏一半给 0.5(不是线性惩罚,漏一两条不至于致命)
  const v = clamp01(0.35 + 0.65 * (got / checks.length))
  return { v, notes: checks.map(noteOf) }
}

/** 一项落实检查的可读备注:✓ 照做 / ~ 半亮 / ✗ 没做到 */
function noteOf(c: { w: number; note: string }): string {
  return `${c.w >= 1 ? '✓' : c.w > 0 ? '~' : '✗'}${c.note}`
}

/**
 * 每条特质轴的**气质词** —— 用于「描述点名的性格,轴有没有亮」这项落实检查。
 *
 * ⚠ 为什么不能用 `fallback.ts` 的 `TRAIT_WORDS`:那份词表是为**生成**服务的,
 * 追求「宁可多点亮一根轴」,所以收得很宽(`cute` 含 `小`/`圆`,`organic` 含 `肉`/`生物`,
 * `luminous` 含 `光`/`亮`)。生成时点亮 `cute` 没坏处,评分时就全是坏处:
 * 「一只**小**东西」也会被判成「点名了可爱」,然后因为 cute 轴没到 2 而扣分 ——
 * 这不是扣分,这是**造出来的**扣分。
 *
 * 所以这里另立一份**高精度**词表:只收本身就明确在表达某种气质的词(多为双字以上),
 * 不收任何单独出现也常见于中性描述的通用字。
 *
 * `luminous` 不在此列 —— 「发光」已经由上面第 4 项按 glow 部件判过了,重复计票。
 */
const VIBE_WORDS: Record<string, string[]> = {
  mechanical: ['机械', '齿轮', '铆钉', '钢铁', '机油', '装甲', '铰链', '蒸汽朋克'],
  organic: ['血肉', '藤蔓', '有机体', '腐肉', '孢子'],
  ethereal: ['空灵', '幽灵', '缥缈', '虚影', '仙气', '半透明'],
  fierce: ['凶猛', '暴戾', '利爪', '獠牙', '狂怒', '狰狞', '杀戮'],
  cute: ['可爱', '萌', '呆萌', '圆头', '软糯', '毛茸茸', '奶乎乎'],
  ancient: ['远古', '上古', '年迈', '沧桑', '古旧', '遗迹', '苍老'],
  cyber: ['赛博', '霓虹', '科幻', '全息', '代码', '数码', '电子', '未来感'],
}

/** 中文/阿拉伯数字 → 数值,用于「六条腿」这种硬要求 */
const NUM_CN_TO_N: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10,
}

/** 腿/足类部件的 id 特征 —— 同时用于「描述点名腿」与「数腿」两处 */
const LIMB_RE = /腿|足|爪|蹄|肢|leg|foot|paw|claw|limb/i

/**
 * 数一数腿/足类部件。
 *
 * ⚠ 曾经的 bug:把 `leg-1`/`leg-2`/`leg-3` 的**末尾序号**当数量求和,
 * 于是 3 条腿算出 6、6 条腿算出 21 ——「六条腿」永远判不中,fidelity 卡在 0.35。
 * 序号只是命名,不是数量。正确做法是**数部件个数**。
 * 例外:`legs-3` 这种带复数前缀的表示「一组 3 条」,才读末尾数字。
 */
function countLimbs(ctx: ScoreContext, re: RegExp): number {
  const parts = ctx.parts
  if (!parts?.length) return 0
  let n = 0
  for (const p of parts) {
    const id = `${p.id ?? ''}`
    if (!re.test(id) && !re.test(`${p.role ?? ''}`)) continue
    // `legs-3` / `feet-2`:复数前缀 + 数字 = 一组的数量
    const group = id.match(/(?:legs|feet|limbs|paws|claws)[-_](\d+)/i)
    n += group ? Number(group[1]) : 1
  }
  return n
}

/** 描述里点名的色相,配色三色里是否真的用上了(按色相距离判定) */
function paletteEchoesColor(dna: CreatureDna, text: string): boolean {
  const named: [RegExp, number][] = [
    [/青|蓝/, 210], [/绿/, 130], [/金/, 45], [/银|白/, 0], [/紫/, 280],
    [/橙/, 30], [/黑/, 0], [/粉/, 330], [/红/, 0], [/霓虹/, 0],
  ]
  const wants = named.filter(([re]) => re.test(text)).map(([, h]) => h)
  if (!wants.length) return true
  const have = [dna.palette.body, dna.palette.accent, dna.palette.glow].map(hsl)
  return wants.some((w) => have.some((c) => hueDist(c[0], w) < 40))
}

/* ---------------------------- 对外 ---------------------------- */

/** 打分的七个维度键,顺序即 `WEIGHTS` 的声明顺序 */
export type ScoreKey = keyof typeof WEIGHTS

/** 各维的权重和为 1 */
export const SCORE_KEYS = Object.keys(WEIGHTS) as readonly ScoreKey[]

export interface ScoreBreakdown {
  palette: number
  traits: number
  motion: number
  narrative: number
  match: number
  /** 结构复杂度:部件数量/角色多样性与骨架完整度 */
  structure: number
  /** 描述落实度:描述里的要求有多少真的变成了部件与动效 */
  fidelity: number
  /** 0..100 */
  total: number
  /**
   * 调试用:这维到底在比什么。空字符串 = 这只没点到任何可验证的特征,拿的是中性分。
   * 页面上把它打出来,免得出现「0.35 分」却不知道在扣什么。
   */
  fidelityNotes?: string[]
}

/**
 * 打分的可选上下文。
 *
 * 为什么需要:只看 `dna` 的话,「部件到底有几个」「用的哪个 motion family」
 * 「有没有触须」这些信息全都不在 DNA 里 —— 而它们恰恰是判断「描述有没有被落实」
 * 的主要依据。所以允许把编译产物传进来;不传时相关维度退回**只看 DNA** 的弱版本,
 * 保持 `heuristicScore(dna)` 老调用点全部可用、结果不崩。
 */
export interface ScoreContext {
  parts?: readonly { role?: string; id?: string; grow?: unknown; appear?: unknown }[]
  motionFamily?: string
  /** 描述里点名的特征词,用于 fidelity */
  mentioned?: readonly string[]
}

/** 对一份合法 DNA 打分;分项均为 0..1 */
export function heuristicScore(
  dna: CreatureDna,
  descr = '',
  ctx: ScoreContext = {},
): ScoreBreakdown {
  const palette = scorePalette(dna)
  const traits = scoreTraits(dna)
  const motion = scoreMotion(dna, ctx)
  const narrative = scoreNarrative(dna, ctx)
  const match = descr.trim() ? scoreMatch(dna, descr) : 0.5
  const structure = scoreStructure(dna, ctx)
  const fid = descr.trim() ? scoreFidelity(dna, descr, ctx) : { v: 0.5, notes: [] as string[] }
  const fidelity = fid.v
  const parts: Record<ScoreKey, number> = {
    palette,
    traits,
    motion,
    narrative,
    match,
    structure,
    fidelity,
  }
  const total = weightedGeometricMean(parts)
  return {
    palette: round3(palette),
    traits: round3(traits),
    motion: round3(motion),
    narrative: round3(narrative),
    match: round3(match),
    structure: round3(structure),
    fidelity: round3(fidelity),
    total: round3(total * 100),
    fidelityNotes: fid.notes,
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
