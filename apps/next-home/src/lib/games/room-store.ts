import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { getDb } from '@/lib/db'
import { GAME_MODULES } from './registry'
import { GameError } from './errors'
import { resolveName } from './names'
import type {
  GameAction,
  GameRoomBase,
  PlayerView,
  RoomPlayer,
  RoomViewBase,
} from './types'
import { isGameId } from './catalog'

const ROOM_PREFIX = 'game_room:'
const ROOM_TTL_MS = 24 * 60 * 60 * 1000
const PRESENCE_TTL_MS = 15_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5

/** 在线状态只在进程内存里，不写库：轮询每秒一次，写库会白白把 SQLite 打满 */
const presence = new Map<string, number>()

function presenceKey(code: string, playerId: string): string {
  return `${code}:${playerId}`
}

function touch(code: string, playerId: string): void {
  presence.set(presenceKey(code, playerId), Date.now())
}

function isOnline(code: string, playerId: string, viewerId: string): boolean {
  if (playerId === viewerId) return true
  const last = presence.get(presenceKey(code, playerId))
  return typeof last === 'number' && Date.now() - last < PRESENCE_TTL_MS
}

function prunePresence(): void {
  if (presence.size < 500) return
  const now = Date.now()
  for (const [key, last] of presence) {
    if (now - last > PRESENCE_TTL_MS * 4) presence.delete(key)
  }
}

function roomKey(code: string): string {
  return `${ROOM_PREFIX}${code}`
}

export function makeTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function tokenMatches(token: string, hash: string): boolean {
  const actual = Buffer.from(makeTokenHash(token), 'hex')
  const expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function normalizeCode(raw: unknown): string {
  if (typeof raw !== 'string') throw new GameError('缺少房间号')
  const code = raw.trim().toUpperCase()
  if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code)) {
    throw new GameError('房间号格式不对')
  }
  return code
}

function newCode(): string {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
    }
    if (!getDb().getMeta(roomKey(code))) return code
  }
  throw new GameError('房间号生成失败，请稍后再试', 503)
}

function saveRoom(room: GameRoomBase): void {
  const raw = JSON.stringify(room)
  if (Buffer.byteLength(raw, 'utf8') > 256 * 1024) {
    throw new GameError('房间数据过大，请重新开一局')
  }
  getDb().setMeta(roomKey(room.code), raw)
}

function parseRoom(raw: string | null): GameRoomBase | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<GameRoomBase>
    if (parsed.schema !== 1 || !parsed.game || !isGameId(parsed.game)) return null
    if (typeof parsed.code !== 'string' || !Array.isArray(parsed.players)) return null
    if (typeof parsed.hostId !== 'string' || typeof parsed.phase !== 'string') return null
    if (!parsed.data || typeof parsed.data !== 'object') return null
    return parsed as GameRoomBase
  } catch {
    return null
  }
}

export function loadRoom(codeRaw: string): GameRoomBase | null {
  const code = normalizeCode(codeRaw)
  return parseRoom(getDb().getMeta(roomKey(code)))
}

function requirePlayer(room: GameRoomBase, playerId: string, token: string): RoomPlayer {
  const player = room.players.find((p) => p.id === playerId)
  if (!player || !tokenMatches(token, player.tokenHash)) {
    throw new GameError('你已不在这个房间，或登录状态已失效', 401)
  }
  return player
}

export function buildRoomView(room: GameRoomBase, viewerId: string): RoomViewBase {
  const mod = GAME_MODULES[room.game]
  const players: PlayerView[] = room.players.map((player, seat) => ({
    id: player.id,
    name: player.name,
    isHost: player.id === room.hostId,
    online: isOnline(room.code, player.id, viewerId),
    seat,
  }))
  const viewer = room.players.find((player) => player.id === viewerId)
  if (!viewer) throw new GameError('你已不在这个房间', 401)

  return {
    game: room.game,
    code: room.code,
    phase: room.phase,
    version: room.version,
    hostId: room.hostId,
    you: { id: viewer.id, name: viewer.name, isHost: viewer.id === room.hostId },
    players,
    data: mod.view(room, viewerId),
  }
}

export interface GameCredentials {
  playerId: string
  token: string
}

export interface CreatedRoom {
  room: GameRoomBase
  player: RoomPlayer
  token: string
}

export function createGameRoom(gameRaw: string, nameRaw: unknown): CreatedRoom {
  if (!isGameId(gameRaw)) throw new GameError('未知游戏')
  const mod = GAME_MODULES[gameRaw]
  const name = resolveName(nameRaw, [])
  const token = randomBytes(24).toString('base64url')
  const now = Date.now()
  const player: RoomPlayer = {
    id: randomBytes(8).toString('hex'),
    name,
    tokenHash: makeTokenHash(token),
    joinedAt: now,
  }
  const room: GameRoomBase = {
    schema: 1,
    game: gameRaw,
    code: newCode(),
    phase: 'lobby',
    version: 1,
    createdAt: now,
    updatedAt: now,
    hostId: player.id,
    players: [player],
    data: {},
  }
  mod.create(room)
  saveRoom(room)
  touch(room.code, player.id)
  pruneOldRooms()
  prunePresence()
  return { room, player, token }
}

export function joinGameRoom(
  codeRaw: string,
  nameRaw: unknown,
): CreatedRoom {
  const code = normalizeCode(codeRaw)
  const room = loadRoom(code)
  if (!room) throw new GameError('房间不存在或已结束', 404)
  const mod = GAME_MODULES[room.game]
  if (!mod.canJoin(room)) {
    if (room.players.length >= mod.maxPlayers) throw new GameError('房间已经满了', 409)
    throw new GameError('这局已经开始了，暂时不能加入', 409)
  }
  const name = resolveName(
    nameRaw,
    room.players.map((p) => p.name),
  )
  const token = randomBytes(24).toString('base64url')
  const player: RoomPlayer = {
    id: randomBytes(8).toString('hex'),
    name,
    tokenHash: makeTokenHash(token),
    joinedAt: Date.now(),
  }
  room.players.push(player)
  room.version += 1
  room.updatedAt = Date.now()
  saveRoom(room)
  touch(room.code, player.id)
  return { room, player, token }
}

export function getRoomView(
  codeRaw: string,
  credentials: GameCredentials,
): { room: GameRoomBase; view: RoomViewBase } {
  const code = normalizeCode(codeRaw)
  const room = loadRoom(code)
  if (!room) throw new GameError('房间不存在或已结束', 404)
  requirePlayer(room, credentials.playerId, credentials.token)
  touch(room.code, credentials.playerId)
  return { room, view: buildRoomView(room, credentials.playerId) }
}

export function actRoom(
  codeRaw: string,
  credentials: GameCredentials,
  action: GameAction,
): { room: GameRoomBase; view: RoomViewBase } {
  const code = normalizeCode(codeRaw)
  const room = loadRoom(code)
  if (!room) throw new GameError('房间不存在或已结束', 404)
  requirePlayer(room, credentials.playerId, credentials.token)
  const type = String(action.type ?? '')

  if (type === 'rename') {
    const name = resolveName(
      action.name,
      room.players.filter((p) => p.id !== credentials.playerId).map((p) => p.name),
    )
    const player = room.players.find((p) => p.id === credentials.playerId)
    if (player) player.name = name
    room.version += 1
    room.updatedAt = Date.now()
    saveRoom(room)
    touch(room.code, credentials.playerId)
    return { room, view: buildRoomView(room, credentials.playerId) }
  }

  if (type === 'kick') {
    if (room.hostId !== credentials.playerId) throw new GameError('只有房主可以踢人', 403)
    const targetId = typeof action.targetId === 'string' ? action.targetId : ''
    if (targetId === credentials.playerId) throw new GameError('不能把自己踢出去')
    const target = room.players.find((p) => p.id === targetId)
    if (!target) throw new GameError('这个人已经不在房间里了')
    room.players = room.players.filter((p) => p.id !== targetId)
    presence.delete(presenceKey(room.code, targetId))
    GAME_MODULES[room.game].onLeave(room, targetId)
    room.version += 1
    room.updatedAt = Date.now()
    saveRoom(room)
    touch(room.code, credentials.playerId)
    return { room, view: buildRoomView(room, credentials.playerId) }
  }

  GAME_MODULES[room.game].act(room, credentials.playerId, action, { now: Date.now() })
  room.version += 1
  room.updatedAt = Date.now()
  saveRoom(room)
  touch(room.code, credentials.playerId)
  return { room, view: buildRoomView(room, credentials.playerId) }
}

export function leaveRoom(codeRaw: string, credentials: GameCredentials): void {
  const code = normalizeCode(codeRaw)
  const room = loadRoom(code)
  if (!room) return
  requirePlayer(room, credentials.playerId, credentials.token)
  room.players = room.players.filter((p) => p.id !== credentials.playerId)
  presence.delete(presenceKey(room.code, credentials.playerId))
  GAME_MODULES[room.game].onLeave(room, credentials.playerId)

  if (room.players.length === 0) {
    getDb().delMeta(roomKey(room.code))
    return
  }
  if (room.hostId === credentials.playerId) {
    room.hostId = room.players[0]?.id ?? room.hostId
  }
  room.version += 1
  room.updatedAt = Date.now()
  saveRoom(room)
}

/** 创建房间时顺手清理 24 小时没动过的房间，避免 meta 表无限长 */
function pruneOldRooms(): void {
  try {
    const db = getDb()
    const keys = db.listMetaKeys(ROOM_PREFIX)
    const now = Date.now()
    let checked = 0
    for (const key of keys) {
      if (checked >= 250) break
      checked += 1
      const raw = db.getMeta(key)
      const room = parseRoom(raw)
      if (!room || now - room.updatedAt > ROOM_TTL_MS) db.delMeta(key)
    }
  } catch {
    /* 清理失败不影响开房 */
  }
}
