import { randomInt } from 'node:crypto'
import { GameError } from './errors'
import {
  DEFAULT_BOMB_RANGE,
  type BombData,
  type BombView,
} from './number-bomb-shared'
import type { GameAction, GameModule, GameRoomBase } from './types'

const MAX_PLAYERS = 8
const MIN_RANGE_SPAN = 10
const MAX_RANGE_VALUE = 999

function dataOf(room: GameRoomBase): BombData {
  return room.data as unknown as BombData
}

function requireHost(room: GameRoomBase, playerId: string): void {
  if (room.hostId !== playerId) throw new GameError('只有房主可以做这个操作', 403)
}

function nextPlayerId(room: GameRoomBase, playerId: string): string {
  const index = room.players.findIndex((p) => p.id === playerId)
  if (index < 0) return room.players[0]?.id ?? ''
  return room.players[(index + 1) % room.players.length]?.id ?? ''
}

function startRound(room: GameRoomBase, data: BombData): void {
  if (room.players.length < 2) throw new GameError('至少需要 2 个人才能开局')
  data.bomb = randomInt(data.min, data.max + 1)
  data.low = data.min
  data.high = data.max
  data.guesses = []
  data.loserId = null
  data.starterId = room.players[randomInt(0, room.players.length)]?.id ?? null
  data.turnId = data.starterId
  room.phase = 'playing'
}

function makeView(room: GameRoomBase, data: BombData): BombView {
  const lastGuess = data.guesses.at(-1) ?? null
  return {
    min: data.min,
    max: data.max,
    low: data.low,
    high: data.high,
    rangeSize: Math.max(0, data.high - data.low + 1),
    turnId: data.turnId,
    starterId: data.starterId,
    guesses: data.guesses,
    lastGuess,
    bomb: room.phase === 'exploded' ? data.bomb : null,
    loserId: data.loserId,
  }
}

export const numberBombModule: GameModule = {
  id: 'number-bomb',
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,

  create(room) {
    room.data = {
      min: DEFAULT_BOMB_RANGE.min,
      max: DEFAULT_BOMB_RANGE.max,
      bomb: 0,
      low: DEFAULT_BOMB_RANGE.min,
      high: DEFAULT_BOMB_RANGE.max,
      turnId: null,
      starterId: null,
      guesses: [],
      loserId: null,
    } satisfies BombData
    room.phase = 'lobby'
  },

  canJoin(room) {
    return room.phase === 'lobby' && room.players.length < MAX_PLAYERS
  },

  view(room) {
    return makeView(room, dataOf(room))
  },

  act(room, playerId, action: GameAction, ctx) {
    const data = dataOf(room)
    const type = String(action.type ?? '')

    if (type === 'config') {
      requireHost(room, playerId)
      if (room.phase !== 'lobby') throw new GameError('开局后不能再改范围')
      const min = Number(action.min)
      const max = Number(action.max)
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new GameError('范围必须是整数')
      }
      if (min < 0 || max > MAX_RANGE_VALUE || min >= max) {
        throw new GameError(`范围需在 0–${MAX_RANGE_VALUE} 内，且最小值小于最大值`)
      }
      if (max - min < MIN_RANGE_SPAN) throw new GameError(`范围至少要有 ${MIN_RANGE_SPAN} 个数字`)
      data.min = min
      data.max = max
      data.low = min
      data.high = max
      return
    }

    if (type === 'start') {
      requireHost(room, playerId)
      if (room.phase === 'playing') throw new GameError('本局还没结束')
      startRound(room, data)
      return
    }

    if (type === 'guess') {
      if (room.phase !== 'playing') throw new GameError('现在不是报数阶段')
      if (data.turnId !== playerId) throw new GameError('还没轮到你')
      const value = Number(action.value)
      if (!Number.isInteger(value)) throw new GameError('请报一个整数')
      if (value < data.low || value > data.high) {
        throw new GameError(`请报 ${data.low}–${data.high} 之间的数字`)
      }
      const guess = {
        id: (data.guesses.at(-1)?.id ?? 0) + 1,
        playerId,
        value,
        at: ctx.now,
      }
      data.guesses.push(guess)
      if (data.guesses.length > 200) data.guesses = data.guesses.slice(-200)

      if (value === data.bomb) {
        data.loserId = playerId
        data.turnId = null
        room.phase = 'exploded'
        return
      }
      if (value < data.bomb) data.low = value + 1
      else data.high = value - 1
      data.turnId = nextPlayerId(room, playerId)
      return
    }

    if (type === 'lobby') {
      requireHost(room, playerId)
      room.phase = 'lobby'
      data.turnId = null
      data.loserId = null
      data.guesses = []
      data.low = data.min
      data.high = data.max
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
      data.loserId = null
      data.guesses = []
      data.low = data.min
      data.high = data.max
    }
  },
}
