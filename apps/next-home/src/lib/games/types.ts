/**
 * 多人酒桌游戏：房间与玩家在服务端的公共形状。
 *
 * 这里刻意不放任何 node 专属依赖：客户端组件可以安全地 `import type`，
 * 具体游戏的规则与随机数则留在各游戏的 server 模块里。
 */

export type GameId = 'liars-dice' | 'number-bomb' | 'dice-789'

export interface RoomPlayer {
  id: string
  name: string
  /** 玩家令牌的 sha256；原始令牌只进 HttpOnly cookie，不下发前端 */
  tokenHash: string
  joinedAt: number
}

/**
 * 落库房间。`data` 由各游戏模块自己解释；公共字段只负责鉴权、房主、
 * 玩家列表与版本号，避免每个游戏重复写一套房间管理。
 */
export interface GameRoomBase {
  schema: 1
  game: GameId
  code: string
  phase: string
  version: number
  createdAt: number
  updatedAt: number
  hostId: string
  players: RoomPlayer[]
  data: Record<string, unknown>
}

export interface PlayerView {
  id: string
  name: string
  isHost: boolean
  online: boolean
  seat: number
}

export interface RoomViewBase<T = unknown> {
  game: GameId
  code: string
  phase: string
  version: number
  hostId: string
  you: { id: string; name: string; isHost: boolean }
  players: PlayerView[]
  data: T
}

export interface GameAction {
  type: string
  [key: string]: unknown
}

/** 游戏模块：创建房间时初始化 data，收到动作时只改 room，由 store 统一下发 */
export interface GameModule {
  id: GameId
  minPlayers: number
  maxPlayers: number
  create(room: GameRoomBase): void
  canJoin(room: GameRoomBase): boolean
  view(room: GameRoomBase, viewerId: string): unknown
  act(room: GameRoomBase, playerId: string, action: GameAction, ctx: { now: number }): void
  /** 玩家主动离开或被房主移出；多数游戏在中途缺人时中止本局回大厅 */
  onLeave(room: GameRoomBase, playerId: string): void
}
