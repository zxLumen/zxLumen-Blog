'use client'

import type { PlayerView } from '@/lib/games/types'

interface PlayerListProps {
  room: {
    you: { id: string }
    players: PlayerView[]
  }
  turnId?: string | null
  isHost: boolean
  onKick?: (player: PlayerView) => void
  renderExtra?: (player: PlayerView) => React.ReactNode
  compact?: boolean
}

export function PlayerList({
  room,
  turnId,
  isHost,
  onKick,
  renderExtra,
  compact = false,
}: PlayerListProps) {
  return (
    <ul className={compact ? 'game-players compact' : 'game-players'}>
      {room.players.map((player) => {
        const isYou = player.id === room.you.id
        const isTurn = player.id === turnId
        return (
          <li
            key={player.id}
            className={`game-player${isYou ? ' you' : ''}${isTurn ? ' turn' : ''}${player.online ? '' : ' offline'}`}
          >
            <span className="game-seat">{player.seat + 1}</span>
            <span className={`game-dot${player.online ? ' online' : ''}`} aria-label={player.online ? '在线' : '离线'} />
            <span className="game-player-name">
              {player.name}
              {isYou ? <em>你</em> : null}
              {player.isHost ? <em className="host">房主</em> : null}
            </span>
            {renderExtra ? <span className="game-player-extra">{renderExtra(player)}</span> : null}
            {isTurn ? <span className="game-turn-tag">轮到</span> : null}
            {!player.online ? <span className="game-offline-tag">离线</span> : null}
            {isHost && !isYou && onKick ? (
              <button
                type="button"
                className="game-kick"
                title={`把 ${player.name} 移出房间`}
                onClick={() => onKick(player)}
              >
                移出
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
