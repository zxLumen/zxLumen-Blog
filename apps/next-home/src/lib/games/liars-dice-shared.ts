/**
 * 骰子吹牛（只开骰版）的纯规则与共享类型。
 *
 * 现在没有喊骰/轮次：每个人各自点一次「摇骰」，所有人摇完后任意人点「开骰」，
 * App 只负责亮出骰子并同时给出「斋 / 飞」两套点数总计，输赢由线下判断。
 */

export type CountMode = 'fei' | 'zhai'

export interface LiarSettings {
  /** 豹子加成开关 */
  leopard: boolean
}

export type LeopardKind = 'none' | 'mixed' | 'pure'

export interface LiarPlayerDice {
  playerId: string
  dice: number[]
  kind: LeopardKind
}

export interface LiarReveal {
  totalDice: number
  totalsZhai: number[]
  totalsFei: number[]
  playerDice: LiarPlayerDice[]
  openedBy: string
  at: number
}

export interface LiarData {
  settings: LiarSettings
  roundNo: number
  /** 每人本局的骰子；只在服务端与「自己 / 开骰后」的视图里出现 */
  dice: Record<string, number[]>
  /** 本局已经点过「摇骰」的人 */
  shaken: Record<string, boolean>
  reveal: LiarReveal | null
  /** 有玩家离开/被移出时中止本局的提示 */
  abortNote?: string
}

export interface LiarView {
  settings: LiarSettings
  roundNo: number
  totalDice: number
  yourDice: number[]
  yourKind: LeopardKind
  yourShaken: boolean
  shakenIds: string[]
  allShaken: boolean
  /** 仅在开骰后下发 */
  playerDice: LiarPlayerDice[] | null
  reveal: LiarReveal | null
  abortNote?: string
}

export const DICE_PER_PLAYER = 5

export const DEFAULT_LIAR_SETTINGS: LiarSettings = {
  leopard: true,
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
  mode: CountMode,
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
  mode: CountMode,
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
