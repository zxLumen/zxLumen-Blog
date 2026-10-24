import { randomInt } from 'node:crypto'
import { GameError } from './errors'
import {
  DICE_PER_PLAYER,
  buildTotals,
  DEFAULT_LIAR_SETTINGS,
  isStraight,
  leopardKind,
  sortDice,
  type LiarData,
  type LiarSettings,
  type LiarView,
} from './liars-dice-shared'
import type { GameAction, GameModule, GameRoomBase } from './types'

const MAX_PLAYERS = 8

function dataOf(room: GameRoomBase): LiarData {
  return room.data as unknown as LiarData
}

function requireHost(room: GameRoomBase, playerId: string): void {
  if (room.hostId !== playerId) throw new GameError('只有房主可以做这个操作', 403)
}

/** 一局只摇一次；顺子（五颗全不同）由服务端自动重摇，不存在手动重摇入口 */
function rollHand(): number[] {
  for (let i = 0; i < 100; i += 1) {
    const dice = Array.from({ length: DICE_PER_PLAYER }, () => randomInt(1, 7))
    if (!isStraight(dice)) return sortDice(dice)
  }
  // 概率上不可能走到这里；真走到了也给一副合法骰子
  return [1, 2, 2, 3, 4]
}

function normalizeSettings(raw: unknown): LiarSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LIAR_SETTINGS }
  const r = raw as Record<string, unknown>
  return { leopard: r.leopard !== false }
}

function startRound(room: GameRoomBase, data: LiarData): void {
  if (room.players.length < 2) throw new GameError('至少需要 2 个人才能开局')
  data.roundNo += 1
  data.dice = {}
  data.shaken = {}
  data.reveal = null
  delete data.abortNote
  room.phase = 'shaking'
}

function makeView(room: GameRoomBase, data: LiarData, viewerId: string): LiarView {
  const revealed = room.phase === 'revealed' && data.reveal !== null
  const yourDice = data.dice[viewerId] ?? []
  const shakenIds = room.players.filter((player) => data.shaken[player.id]).map((player) => player.id)
  const playerDice = revealed
    ? room.players.map((player) => {
        const dice = data.dice[player.id] ?? []
        return { playerId: player.id, dice, kind: leopardKind(dice) }
      })
    : null

  return {
    settings: data.settings,
    roundNo: data.roundNo,
    totalDice: room.players.length * DICE_PER_PLAYER,
    yourDice,
    yourKind: leopardKind(yourDice),
    yourShaken: data.shaken[viewerId] === true,
    shakenIds,
    allShaken: room.players.length > 0 && shakenIds.length === room.players.length,
    playerDice,
    reveal: data.reveal,
    ...(data.abortNote ? { abortNote: data.abortNote } : {}),
  }
}

export const liarDiceModule: GameModule = {
  id: 'liars-dice',
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,

  create(room) {
    room.data = {
      settings: { ...DEFAULT_LIAR_SETTINGS },
      roundNo: 0,
      dice: {},
      shaken: {},
      reveal: null,
    } satisfies LiarData
    room.phase = 'lobby'
  },

  canJoin(room) {
    return room.phase === 'lobby' && room.players.length < MAX_PLAYERS
  },

  view(room, viewerId) {
    return makeView(room, dataOf(room), viewerId)
  },

  act(room, playerId, action: GameAction, ctx) {
    const data = dataOf(room)
    const type = String(action.type ?? '')

    if (type === 'settings') {
      requireHost(room, playerId)
      if (room.phase !== 'lobby') throw new GameError('开局后不能再改规则')
      data.settings = normalizeSettings(action.settings)
      return
    }

    if (type === 'start') {
      requireHost(room, playerId)
      if (room.phase !== 'lobby' && room.phase !== 'revealed') {
        throw new GameError('本局还没结束')
      }
      startRound(room, data)
      return
    }

    if (type === 'lobby') {
      requireHost(room, playerId)
      if (room.phase === 'shaking') throw new GameError('本局还在摇骰，先等大家摇完或把离线的人移出')
      room.phase = 'lobby'
      data.reveal = null
      data.dice = {}
      data.shaken = {}
      delete data.abortNote
      return
    }

    if (type === 'shake') {
      if (room.phase !== 'shaking') throw new GameError('现在不是摇骰阶段')
      if (!room.players.some((player) => player.id === playerId)) {
        throw new GameError('你已不在这个房间')
      }
      if (data.shaken[playerId]) throw new GameError('本局你已经摇过了，不能重摇')
      data.dice[playerId] = rollHand()
      data.shaken[playerId] = true
      return
    }

    if (type === 'open') {
      if (room.phase !== 'shaking') throw new GameError('现在不能开骰')
      const allShaken =
        room.players.length > 0 && room.players.every((player) => data.shaken[player.id])
      if (!allShaken) throw new GameError('还有人没摇骰，等所有人摇完再开')

      const totalDice = room.players.length * DICE_PER_PLAYER
      data.reveal = {
        totalDice,
        totalsZhai: buildTotals(data.dice, 'zhai', data.settings.leopard),
        totalsFei: buildTotals(data.dice, 'fei', data.settings.leopard),
        playerDice: room.players.map((player) => {
          const dice = data.dice[player.id] ?? []
          return { playerId: player.id, dice, kind: leopardKind(dice) }
        }),
        openedBy: playerId,
        at: ctx.now,
      }
      room.phase = 'revealed'
      return
    }

    throw new GameError('未知操作')
  },

  onLeave(room) {
    const data = dataOf(room)
    if (room.phase !== 'lobby') {
      room.phase = 'lobby'
      data.dice = {}
      data.shaken = {}
      data.reveal = null
      data.abortNote = '有玩家离开或被移出，本局已中止，请重新开始'
    }
  },
}
