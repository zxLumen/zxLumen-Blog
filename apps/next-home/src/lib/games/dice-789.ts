import { randomInt } from 'node:crypto'
import { GameError } from './errors'
import {
  type Dice789Data,
  type Dice789Roll,
  type Dice789View,
  type RollEffect,
} from './dice-789-shared'
import type { GameAction, GameModule, GameRoomBase } from './types'

const MAX_PLAYERS = 8

function dataOf(room: GameRoomBase): Dice789Data {
  return room.data as unknown as Dice789Data
}

function requireHost(room: GameRoomBase, playerId: string): void {
  if (room.hostId !== playerId) throw new GameError('只有房主可以做这个操作', 403)
}

function nextPlayerId(room: GameRoomBase, playerId: string, direction: 1 | -1): string {
  const index = room.players.findIndex((p) => p.id === playerId)
  if (index < 0) return room.players[0]?.id ?? ''
  const len = room.players.length
  const next = (index + direction + len) % len
  return room.players[next]?.id ?? ''
}

function makeView(data: Dice789Data): Dice789View {
  return {
    pot: data.pot,
    direction: data.direction,
    turnId: data.turnId,
    starterId: data.starterId,
    rolls: data.rolls,
    lastRoll: data.rolls.at(-1) ?? null,
    drinks: data.drinks,
  }
}

export const dice789Module: GameModule = {
  id: 'dice-789',
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,

  create(room) {
    room.data = {
      pot: 0,
      direction: 1,
      turnId: null,
      starterId: null,
      rolls: [],
      drinks: {},
    } satisfies Dice789Data
    room.phase = 'lobby'
  },

  canJoin(room) {
    return room.phase === 'lobby' && room.players.length < MAX_PLAYERS
  },

  view(room) {
    return makeView(dataOf(room))
  },

  act(room, playerId, action: GameAction, ctx) {
    const data = dataOf(room)
    const type = String(action.type ?? '')

    if (type === 'start') {
      requireHost(room, playerId)
      if (room.players.length < 2) throw new GameError('至少需要 2 个人才能开局')
      data.pot = 0
      data.direction = 1
      data.rolls = []
      data.drinks = {}
      data.starterId = room.players[randomInt(0, room.players.length)]?.id ?? null
      data.turnId = data.starterId
      room.phase = 'playing'
      return
    }

    if (type === 'roll') {
      if (room.phase !== 'playing') throw new GameError('现在不是摇骰阶段')
      if (data.turnId !== playerId) throw new GameError('还没轮到你')

      const dice: [number, number] = [randomInt(1, 7), randomInt(1, 7)]
      const sum = dice[0] + dice[1]
      let effect: RollEffect = 'none'
      let drank = 0
      let direction = data.direction

      if (dice[0] === 1 && dice[1] === 1) {
        effect = 'ones'
        drank = 1
        for (const player of room.players) {
          data.drinks[player.id] = (data.drinks[player.id] ?? 0) + 1
        }
      } else if (dice[0] === dice[1]) {
        effect = 'pair'
        direction = direction === 1 ? -1 : 1
      } else if (sum === 7) {
        effect = 'add'
        data.pot += 1
      } else if (sum === 8) {
        effect = 'half'
        drank = Math.ceil(data.pot / 2)
        data.pot = Math.max(0, data.pot - drank)
        if (drank > 0) data.drinks[playerId] = (data.drinks[playerId] ?? 0) + drank
      } else if (sum === 9) {
        effect = 'all'
        drank = data.pot
        data.pot = 0
        if (drank > 0) data.drinks[playerId] = (data.drinks[playerId] ?? 0) + drank
      }

      const roll: Dice789Roll = {
        id: (data.rolls.at(-1)?.id ?? 0) + 1,
        playerId,
        dice,
        sum,
        effect,
        drank,
        potAfter: data.pot,
        directionAfter: direction,
        at: ctx.now,
      }
      data.rolls.push(roll)
      if (data.rolls.length > 120) data.rolls = data.rolls.slice(-120)
      data.direction = direction
      data.turnId = nextPlayerId(room, playerId, direction)
      return
    }

    if (type === 'lobby') {
      requireHost(room, playerId)
      room.phase = 'lobby'
      data.turnId = null
      data.starterId = null
      data.rolls = []
      data.pot = 0
      data.drinks = {}
      data.direction = 1
      return
    }

    throw new GameError('未知操作')
  },

  onLeave(room) {
    const data = dataOf(room)
    if (room.phase !== 'lobby') {
      room.phase = 'lobby'
      data.turnId = null
      data.starterId = null
      data.rolls = []
      data.pot = 0
      data.drinks = {}
      data.direction = 1
    }
  },
}
