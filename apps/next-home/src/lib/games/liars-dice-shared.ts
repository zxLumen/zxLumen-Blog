/**
 * 骰子吹牛（大话骰）的纯规则与共享类型。
 *
 * 这里不引入随机数 / SQLite，客户端可以用同一套函数算「下一步最低叫多少」，
 * 服务端仍会再校验一次。规则口径见 GAME_CATALOG 与页面里的规则面板。
 */

export type BidMode = 'fei' | 'zhai'

export interface LiarSettings {
  /** 起叫数量：按人数，或固定 2 个起 */
  startCount: 'players' | 'two'
  /** 斋转飞：传统双倍，或线上常见的 +2 */
  zhaiToFei: 'double' | 'plus2'
  /** 豹子加成开关 */
  leopard: boolean
}

export interface LiarBid {
  id: number
  playerId: string
  q: number
  face: number
  mode: BidMode
  at: number
}

export type LeopardKind = 'none' | 'mixed' | 'pure'

export interface LiarPlayerDice {
  playerId: string
  dice: number[]
  kind: LeopardKind
}

export interface LiarReveal {
  bid: LiarBid
  openerId: string
  bidderId: string
  actual: number
  success: boolean
  loserId: string
  totalDice: number
  totalsZhai: number[]
  totalsFei: number[]
  playerDice: LiarPlayerDice[]
  at: number
}

export interface LiarData {
  settings: LiarSettings
  roundNo: number
  starterId: string | null
  turnId: string | null
  /** 每人本局的骰子；只在服务端与「自己 / 开骰后」的视图里出现 */
  dice: Record<string, number[]>
  bids: LiarBid[]
  reveal: LiarReveal | null
  /** 有玩家离开/被移出时中止本局的提示 */
  abortNote?: string
}

export interface LiarView {
  settings: LiarSettings
  roundNo: number
  starterId: string | null
  turnId: string | null
  bids: LiarBid[]
  currentBid: LiarBid | null
  totalDice: number
  minStart: number
  yourDice: number[]
  yourKind: LeopardKind
  /** 仅在开骰后下发 */
  playerDice: LiarPlayerDice[] | null
  reveal: LiarReveal | null
  abortNote?: string
}

export const DICE_PER_PLAYER = 5
export const MAX_BID_QUANTITY = 99

export const DEFAULT_LIAR_SETTINGS: LiarSettings = {
  startCount: 'players',
  zhaiToFei: 'double',
  leopard: true,
}

/** 斋时 1 最大；飞时 1 不能作为叫点（选 1 会自动转斋） */
export function faceRank(face: number, mode: BidMode): number {
  return mode === 'zhai' && face === 1 ? 7 : face
}

export function isStraight(dice: number[]): boolean {
  return new Set(dice).size === dice.length
}

export function sortDice(dice: number[]): number[] {
  return [...dice].sort((a, b) => a - b)
}

export function leopardKind(dice: number[]): LeopardKind {
  if (dice.length === 0) return 'none'
  if (dice.every((d) => d === dice[0])) return 'pure'
  const ones = dice.filter((d) => d === 1).length
  const rest = dice.filter((d) => d !== 1)
  if (ones > 0 && rest.length > 0 && rest.every((d) => d === rest[0])) return 'mixed'
  return 'none'
}

/**
 * 统计单个玩家对某个点数的贡献。
 * - 斋 / 叫 1：1 不万能；五个同点（含五个 1）额外 +2。
 * - 飞：1 万能；五个「有效同点」（含 1 凑成）额外 +1，五个实际完全相同 +2。
 */
export function countFace(
  dice: number[],
  face: number,
  mode: BidMode,
  leopard = true,
): number {
  if (dice.length === 0) return 0
  const ones = dice.filter((d) => d === 1).length
  const faceCount = dice.filter((d) => d === face).length
  const pure = dice.every((d) => d === dice[0])

  if (mode === 'zhai' || face === 1) {
    let count = faceCount
    if (leopard && pure && dice[0] === face) count += 2
    return count
  }

  let count = faceCount + ones
  if (leopard && count === dice.length) {
    count += pure ? 2 : 1
  }
  return count
}

export function buildTotals(
  diceByPlayer: Record<string, number[]>,
  mode: BidMode,
  leopard = true,
): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0]
  for (const dice of Object.values(diceByPlayer)) {
    for (let face = 1; face <= 6; face += 1) {
      totals[face] += countFace(dice, face, mode, leopard)
    }
  }
  return totals
}

export function actualForBid(
  diceByPlayer: Record<string, number[]>,
  bid: Pick<LiarBid, 'face' | 'mode'>,
  leopard = true,
): number {
  let total = 0
  for (const dice of Object.values(diceByPlayer)) {
    total += countFace(dice, bid.face, bid.mode, leopard)
  }
  return total
}

export interface BidCheck {
  ok: boolean
  /** 规范化后的模式（叫 1 自动转斋） */
  mode: BidMode
  reason?: string
}

/** 服务端与客户端共用的合法性校验；客户端提前提示，服务端仍是最终裁判 */
export function checkBid(
  prev: LiarBid | null,
  candidate: { q: number; face: number; mode: BidMode },
  settings: LiarSettings,
  playerCount: number,
): BidCheck {
  const q = Number(candidate.q)
  const face = Number(candidate.face)
  const mode: BidMode = face === 1 ? 'zhai' : candidate.mode === 'zhai' ? 'zhai' : 'fei'

  if (!Number.isInteger(q) || q < 1 || q > MAX_BID_QUANTITY) {
    return { ok: false, mode, reason: `数量需为 1–${MAX_BID_QUANTITY} 的整数` }
  }
  if (!Number.isInteger(face) || face < 1 || face > 6) {
    return { ok: false, mode, reason: '点数需在 1–6 之间' }
  }
  if (mode === 'fei' && face === 1) {
    return { ok: false, mode: 'zhai', reason: '叫 1 点必须用斋' }
  }

  if (!prev) {
    const min = settings.startCount === 'two' ? 2 : Math.max(2, playerCount)
    if (q < min) return { ok: false, mode, reason: `起叫至少 ${min} 个` }
    return { ok: true, mode }
  }

  if (mode === prev.mode) {
    if (q > prev.q) return { ok: true, mode }
    if (q === prev.q && faceRank(face, mode) > faceRank(prev.face, prev.mode)) {
      return { ok: true, mode }
    }
    return {
      ok: false,
      mode,
      reason: `同模式下要叫得更大：数量 +1，或同数量点更大`,
    }
  }

  // 斋 → 飞：解除斋，1 恢复万能；需要双倍或 +2
  if (mode === 'fei') {
    const need = settings.zhaiToFei === 'double' ? prev.q * 2 : prev.q + 2
    if (q < need) {
      return {
        ok: false,
        mode,
        reason: `斋转飞至少要 ${need} 个（${settings.zhaiToFei === 'double' ? '双倍' : '+2'}）`,
      }
    }
    return { ok: true, mode }
  }

  // 飞 → 斋：可以少 1 个；数量不降时仍按同模式的「更大」比较
  if (q === prev.q - 1) return { ok: true, mode }
  if (q > prev.q) return { ok: true, mode }
  if (q === prev.q && faceRank(face, 'zhai') > faceRank(prev.face, 'fei')) {
    return { ok: true, mode }
  }
  return {
    ok: false,
    mode,
    reason: `飞转斋最多只能少 1 个；否则要叫得更大`,
  }
}

export function bidLabel(bid: Pick<LiarBid, 'q' | 'face' | 'mode'>): string {
  return `${bid.q} 个 ${bid.face} · ${bid.mode === 'zhai' ? '斋' : '飞'}`
}
