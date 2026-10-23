import { dice789Module } from './dice-789'
import { liarDiceModule } from './liars-dice'
import { numberBombModule } from './number-bomb'
import type { GameId, GameModule } from './types'

export const GAME_MODULES: Record<GameId, GameModule> = {
  'liars-dice': liarDiceModule,
  'number-bomb': numberBombModule,
  'dice-789': dice789Module,
}
