export interface BombSettings {
  min: number
  max: number
}

export interface BombGuess {
  id: number
  playerId: string
  value: number
  at: number
}

export interface BombData {
  min: number
  max: number
  /** 炸弹数；开牌前不下发 */
  bomb: number
  low: number
  high: number
  turnId: string | null
  starterId: string | null
  guesses: BombGuess[]
  loserId: string | null
}

export interface BombView {
  min: number
  max: number
  low: number
  high: number
  rangeSize: number
  turnId: string | null
  starterId: string | null
  guesses: BombGuess[]
  lastGuess: BombGuess | null
  /** 仅爆炸后下发 */
  bomb: number | null
  loserId: string | null
}

export const DEFAULT_BOMB_RANGE: BombSettings = { min: 1, max: 100 }
