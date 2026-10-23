'use client'

import { useState } from 'react'
import type { GameCatalogItem } from '@/lib/games/catalog'
import type { AnyRoomView } from './game-client'

interface RoomHeaderProps {
  game: GameCatalogItem
  room: AnyRoomView
  onRename: () => void
  onLeave: () => void
  onBack: () => void
}

function phaseLabel(phase: string): string {
  if (phase === 'lobby') return '等人中'
  if (phase === 'revealed' || phase === 'exploded') return '本局结束'
  return '进行中'
}

export function RoomHeader({ game, room, onRename, onLeave, onBack }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false)
  const online = room.players.filter((player) => player.online).length

  const copyInvite = async () => {
    const base =
      typeof window === 'undefined'
        ? game.href
        : `${window.location.origin}${game.href}`
    const url = `${base}?room=${encodeURIComponent(room.code)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt('复制这条邀请链接给朋友：', url)
    }
  }

  return (
    <header className="game-room-head" style={{ '--game-accent': game.accent } as React.CSSProperties}>
      <div className="game-room-left">
        <button type="button" className="game-back" onClick={onBack}>
          ← 酒桌
        </button>
        <div>
          <div className="game-room-kicker">
            {game.emoji} {game.name} · {phaseLabel(room.phase)}
          </div>
          <div className="game-room-code">
            房间 <b>{room.code}</b>
            <button type="button" className="game-copy" onClick={copyInvite}>
              {copied ? '已复制' : '复制邀请'}
            </button>
          </div>
        </div>
      </div>
      <div className="game-room-right">
        <div className="game-you">
          <span className="game-dot online" />
          你是 <b>{room.you.name}</b>
          <button type="button" className="game-text-btn" onClick={onRename}>
            改昵称
          </button>
        </div>
        <div className="game-room-meta">
          <span>{online}/{room.players.length} 在线</span>
          <span>·</span>
          <span>{game.players}</span>
          <button type="button" className="game-text-btn danger" onClick={onLeave}>
            离开
          </button>
        </div>
      </div>
    </header>
  )
}
