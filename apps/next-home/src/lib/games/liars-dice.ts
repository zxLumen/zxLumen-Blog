import { randomInt } from 'node:crypto'
import { GameError } from './errors'
import {
  DICE_PER_PLAYER,
  actualForBid,
  buildTotals,
  checkBid,
  DEFAULT_LIAR_SETTINGS,
  isStraight,
  leopardKind,
  sortDice,
  type BidMode,
  type LiarBid,
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

function requireTurn(room: GameRoomBase, data: LiarData, playerId: string): void {
  if (room.phase !== 'bidding') throw new GameError('现在不是叫骰阶段')
  if (data.turnId !== playerId) throw new GameError('还没轮到你')
}

function nextPlayerId(room: GameRoomBase, playerId: string): string {
  const index = room.players.findIndex((p) => p.id === playerId)
  if (index < 0) return room.players[0]?.id ?? ''
  return room.players[(index + 1) % room.players.length]?.id ?? ''
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
  return {
    startCount: r.startCount === 'two' ? 'two' : 'players',
    zhaiToFei: r.zhaiToFei === 'plus2' ? 'plus2' : 'double',
    leopard: r.leopard !== false,
  }
}

function startRound(room: GameRoomBase, data: LiarData, starterId?: unknown): void {
  if (room.players.length < 2) throw new GameError('至少需要 2 个人才能开局')
  const requested = typeof starterId === 'string' ? starterId : ''
  let starter = room.players.some((p) => p.id === requested) ? requested : ''
  if (!starter) {
    if (room.phase === 'revealed' && data.reveal) starter = data.reveal.loserId
    else starter = room.players[randomInt(0, room.players.length)]?.id ?? ''
  }

  const dice: Record<string, number[]> = {}
  for (const player of room.players) dice[player.id] = rollHand()

  data.roundNo += 1
  data.starterId = starter
  data.turnId = starter
  data.dice = dice
  data.bids = []
  data.reveal = null
  delete data.abortNote
  room.phase = 'bidding'
}

function makeView(room: GameRoomBase, data: LiarData, viewerId: string): LiarView {
  const last = data.bids.at(-1) ?? null
  const revealed = room.phase === 'revealed' && data.reveal !== null
  const yourDice = data.dice[viewerId] ?? []
  const playerDice = revealed
    ? room.players.map((player) => {
        const dice = data.dice[player.id] ?? []
        return { playerId: player.id, dice, kind: leopardKind(dice) }
      })
    : null

  return {
    settings: data.settings,
    roundNo: data.roundNo,
    starterId: data.starterId,
    turnId: data.turnId,
    bids: data.bids,
    currentBid: last,
    totalDice: room.players.length * DICE_PER_PLAYER,
    minStart: data.settings.startCount === 'two' ? 2 : Math.max(2, room.players.length),
    yourDice,
    yourKind: leopardKind(yourDice),
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
      starterId: null,
      turnId: null,
      dice: {},
      bids: [],
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
      startRound(room, data, action.starterId)
      return
    }

    if (type === 'lobby') {
      requireHost(room, playerId)
      if (room.phase === 'bidding') throw new GameError('本局还在进行，先开骰或等人离开后再回大厅')
      room.phase = 'lobby'
      data.turnId = null
      data.starterId = null
      data.bids = []
      data.reveal = null
      data.dice = {}
      delete data.abortNote
      return
    }

    if (type === 'bid') {
      requireTurn(room, data, playerId)
      const prev = data.bids.at(-1) ?? null
      const raw = {
        q: Number(action.q),
        face: Number(action.face),
        mode: (action.mode === 'zhai' ? 'zhai' : 'fei') as BidMode,
      }
      const checked = checkBid(prev, raw, data.settings, room.players.length)
      if (!checked.ok) throw new GameError(checked.reason ?? '这个叫法不合法')

      const bid: LiarBid = {
        id: (prev?.id ?? 0) + 1,
        playerId,
        q: raw.q,
        face: raw.face,
        mode: checked.mode,
        at: ctx.now,
      }
      data.bids.push(bid)
      if (data.bids.length > 80) data.bids = data.bids.slice(-80)
      data.turnId = nextPlayerId(room, playerId)
      return
    }

    if (type === 'open') {
      requireTurn(room, data, playerId)
      const bid = data.bids.at(-1)
      if (!bid) throw new GameError('还没有人叫骰，不能开')

      const actual = actualForBid(data.dice, bid, data.settings.leopard)
      const success = actual >= bid.q
      const loserId = success ? playerId : bid.playerId
      const totalDice = room.players.length * DICE_PER_PLAYER
      data.reveal = {
        bid,
        openerId: playerId,
        bidderId: bid.playerId,
        actual,
        success,
        loserId,
        totalDice,
        totalsZhai: buildTotals(data.dice, 'zhai', data.settings.leopard),
        totalsFei: buildTotals(data.dice, 'fei', data.settings.leopard),
        playerDice: room.players.map((player) => {
          const dice = data.dice[player.id] ?? []
          return { playerId: player.id, dice, kind: leopardKind(dice) }
        }),
        at: ctx.now,
      }
      data.turnId = null
      room.phase = 'revealed'
      return
    }

    throw new GameError('未知操作')
  },

  onLeave(room, playerId) {
    const data = dataOf(room)
    delete data.dice[playerId]
    if (room.phase !== 'lobby') {
      room.phase = 'lobby'
      data.turnId = null
      data.starterId = null
      data.bids = []
      data.reveal = null
      data.dice = {}
      data.abortNote = '有玩家离开或被移出，本局已中止，请重新开始'
    }
  },
}
