export type RollEffect = 'add' | 'half' | 'all' | 'ones' | 'pair' | 'none'

export interface Dice789Roll {
  id: number
  playerId: string
  dice: [number, number]
  sum: number
  effect: RollEffect
  /** 本次实际喝掉的「口」数 */
  drank: number
  /** 本次之后的公杯口数 */
  potAfter: number
  /** 本次之后的方向：1 顺时针，-1 逆时针 */
  directionAfter: 1 | -1
  at: number
}

export interface Dice789Data {
  pot: number
  direction: 1 | -1
  turnId: string | null
  starterId: string | null
  rolls: Dice789Roll[]
  /** 每人累计喝了几口，仅作酒桌记录 */
  drinks: Record<string, number>
}

export interface Dice789View {
  pot: number
  direction: 1 | -1
  turnId: string | null
  starterId: string | null
  rolls: Dice789Roll[]
  lastRoll: Dice789Roll | null
  drinks: Record<string, number>
}

export const EFFECT_LABEL: Record<RollEffect, string> = {
  add: '公杯 +1 口',
  half: '喝掉公杯一半',
  all: '喝光公杯',
  ones: '两个 1：全场各喝 1 口',
  pair: '对子：方向反转',
  none: '安全通过',
}
