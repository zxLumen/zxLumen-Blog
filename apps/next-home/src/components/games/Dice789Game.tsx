'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { GAME_BY_ID } from '@/lib/games/catalog'
import { EFFECT_LABEL, type Dice789View } from '@/lib/games/dice-789-shared'
import type { PlayerView } from '@/lib/games/types'
import { ConfirmDialog } from './ConfirmDialog'
import { DiceHand } from './Dice'
import { GameEntry } from './GameEntry'
import { PlayerList } from './PlayerList'
import { RenameDialog } from './RenameDialog'
import { RoomHeader } from './RoomHeader'
import { useGameRoom, type AnyRoomView } from './game-client'

type DiceRoom = AnyRoomView & { data: Dice789View }

interface PendingConfirm {
  title: string
  description: React.ReactNode
  confirmText: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
}

export function Dice789Game() {
  const game = GAME_BY_ID.get('dice-789')!
  const router = useRouter()
  const { room: rawRoom, checking, busy, error, inviteCode, create, join, act, leave, clearError } =
    useGameRoom('dice-789')
  const room = rawRoom as DiceRoom | null
  const data = room?.data

  const [renameOpen, setRenameOpen] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [rolling, setRolling] = useState(false)
  const lastRollId = useRef(0)
  const initialized = useRef(false)
  const rollTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!data) return
    const id = data.lastRoll?.id ?? 0
    if (!initialized.current) {
      initialized.current = true
      lastRollId.current = id
      return
    }
    if (id !== lastRollId.current && id > 0) {
      lastRollId.current = id
      if (rollTimerRef.current) window.clearTimeout(rollTimerRef.current)
      window.setTimeout(() => setRolling(true), 0)
      rollTimerRef.current = window.setTimeout(() => {
        setRolling(false)
        rollTimerRef.current = null
      }, 900)
    }
  }, [data])

  useEffect(
    () => () => {
      if (rollTimerRef.current) window.clearTimeout(rollTimerRef.current)
    },
    [],
  )

  if (checking) {
    return (
      <div className="game-loading">
        <span className="ld-loading-die">🍻</span>
        <p>正在找回你的房间…</p>
      </div>
    )
  }

  if (!room || !data) {
    return (
      <GameEntry
        game={game}
        defaultCode={inviteCode}
        busy={busy}
        error={error}
        onCreate={(name) => void create(name)}
        onJoin={(code, name) => void join(code, name)}
        onClearError={clearError}
      />
    )
  }

  const yourTurn = data.turnId === room.you.id
  const last = data.lastRoll
  const lastPlayer = last ? room.players.find((p) => p.id === last.playerId) : null

  const goHub = () => {
    void leave().then(() => router.push('/games'))
  }

  const requestLeave = () => {
    if (room.phase === 'lobby') {
      goHub()
      return
    }
    setConfirm({
      title: '现在离开会中止本局',
      description: '中途离开会让本局作废，回到大厅。只是关掉页面不会退出，下次打开还能凭 cookie 回来。',
      confirmText: '离开房间',
      tone: 'danger',
      onConfirm: () => {
        setConfirm(null)
        goHub()
      },
    })
  }

  const requestKick = (target: PlayerView) => {
    setConfirm({
      title: `把 ${target.name} 移出房间？`,
      description: '移出后他的 cookie 就回不到这局了；本局会回到大厅重新开始。',
      confirmText: '移出房间',
      tone: 'danger',
      onConfirm: () => {
        setConfirm(null)
        void act({ type: 'kick', targetId: target.id })
      },
    })
  }

  const reset = () => {
    setConfirm({
      title: '结束当前这一局？',
      description: '公杯和喝数会清空，回到大厅重新开始。',
      confirmText: '回大厅',
      tone: 'danger',
      onConfirm: () => {
        setConfirm(null)
        void act({ type: 'lobby' })
      },
    })
  }

  return (
    <div className={`game-page dice789-page${rolling ? ' rolling' : ''}`} style={{ '--game-accent': game.accent } as React.CSSProperties}>
      <RoomHeader game={game} room={room} onRename={() => setRenameOpen(true)} onLeave={requestLeave} onBack={requestLeave} />

      <div className="d789-layout">
        <main className="d789-stage">
          {room.phase === 'lobby' ? (
            <section className="game-card d789-lobby">
              <div className="d789-hero">
                <span className="d789-hero-emoji">🍻</span>
                <div>
                  <div className="ld-eyebrow">七八九</div>
                  <h2>房间 {room.code}</h2>
                  <p>两颗骰子轮流传公杯：7 加酒，8 喝一半，9 喝光。</p>
                </div>
              </div>
              <div className="d789-lobby-stats">
                <span>公杯 <b>0</b> 口</span>
                <span>顺时针</span>
                <span><b>{room.players.length}</b> 人</span>
              </div>
              {room.you.isHost ? (
                <button
                  type="button"
                  className="game-btn primary d789-start"
                  disabled={busy || room.players.length < 2}
                  onClick={() => void act({ type: 'start' })}
                >
                  {room.players.length < 2 ? '至少 2 人才能开局' : '开摇'}
                </button>
              ) : (
                <p className="ld-wait-host">等房主开摇…</p>
              )}
            </section>
          ) : null}

          {room.phase === 'playing' ? (
            <section className="d789-playing">
              <div className="d789-turn">
                <div>
                  <div className="ld-eyebrow">轮到</div>
                  <h2>{yourTurn ? '该你摇' : `${room.players.find((p) => p.id === data.turnId)?.name ?? '对手'} 摇`}</h2>
                  <p>{yourTurn ? '摇两颗骰子，按点数执行酒桌指令。' : '等对方摇完，公杯和方向会立即更新。'}</p>
                </div>
                <div className="d789-direction" aria-label={data.direction === 1 ? '顺时针' : '逆时针'}>
                  <span className={data.direction === 1 ? 'cw' : 'ccw'}>↻</span>
                  <em>{data.direction === 1 ? '顺时针' : '逆时针'}</em>
                </div>
              </div>

              <div className="d789-table game-card">
                <div className="d789-pot">
                  <span className="ld-eyebrow">公杯</span>
                  <div className="d789-pot-cup">
                    <i style={{ height: data.pot > 0 ? `${Math.min(100, data.pot * 12 + 8)}%` : '0%' }} />
                    <b>{data.pot}</b>
                  </div>
                  <span>口</span>
                </div>
                <div className="d789-center">
                  <div className="d789-dice-tray">
                    {rolling ? (
                      <DiceHand dice={[]} count={2} rolling small />
                    ) : last ? (
                      <DiceHand dice={last.dice} count={2} small />
                    ) : (
                      <DiceHand dice={[0, 0]} count={2} hidden small />
                    )}
                  </div>
                  <div className="d789-effect">
                    {rolling ? (
                      <span>摇骰中…</span>
                    ) : last ? (
                      <>
                        <b>{lastPlayer?.name ?? '玩家'} 摇出 {last.sum} 点</b>
                        <span>{EFFECT_LABEL[last.effect]}</span>
                        {last.drank > 0 ? <em>喝 {last.drank} 口</em> : null}
                      </>
                    ) : (
                      <span>还没有人摇</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="d789-action-row">
                {yourTurn ? (
                  <button
                    type="button"
                    className="game-btn primary d789-roll"
                    disabled={busy}
                    onClick={() => void act({ type: 'roll' })}
                  >
                    摇骰
                  </button>
                ) : (
                  <div className="ld-waiting game-card">
                    <span className="ld-wait-dot" />
                    <p>等 <b>{room.players.find((p) => p.id === data.turnId)?.name ?? '对手'}</b> 摇骰…</p>
                  </div>
                )}
                {room.you.isHost ? (
                  <button type="button" className="game-btn ghost" disabled={busy} onClick={reset}>
                    结束本局
                  </button>
                ) : null}
              </div>

              <div className="d789-history game-card">
                <h3>摇骰记录</h3>
                {data.rolls.length === 0 ? (
                  <p className="game-side-empty">还没有人摇</p>
                ) : (
                  <ol>
                    {data.rolls.slice(-8).map((roll) => (
                      <li key={roll.id}>
                        <span>#{roll.id}</span>
                        <b>{room.players.find((p) => p.id === roll.playerId)?.name ?? '玩家'}</b>
                        <em>{roll.dice[0]} + {roll.dice[1]} = {roll.sum}</em>
                        <small>{EFFECT_LABEL[roll.effect]}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          ) : null}
        </main>

        <aside className="d789-side">
          <div className="game-side-card">
            <div className="ld-side-head">
              <h3>玩家 · 喝数</h3>
              <span>{room.players.filter((p) => p.online).length}/{room.players.length} 在线</span>
            </div>
            <PlayerList
              room={room}
              turnId={data.turnId}
              isHost={room.you.isHost}
              onKick={requestKick}
              renderExtra={(player) => (
                <span className={`d789-drinks${(data.drinks[player.id] ?? 0) > 0 ? ' has' : ''}`}>
                  {data.drinks[player.id] ?? 0} 口
                </span>
              )}
            />
            <p className="game-side-note">关掉页面不会退出，下次打开会凭 cookie 回到这里。</p>
          </div>
          <details className="game-side-card" open>
            <summary>规则速查</summary>
            <ul>
              {game.rules.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </details>
          <button type="button" className="ld-switch-game" onClick={requestLeave}>换个游戏 →</button>
        </aside>
      </div>

      <RenameDialog
        open={renameOpen}
        current={room.you.name}
        busy={busy}
        accent={game.accent}
        onSave={(name) => {
          void act({ type: 'rename', name }).then((ok) => {
            if (ok) setRenameOpen(false)
          })
        }}
        onClose={() => setRenameOpen(false)}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmText={confirm?.confirmText}
        tone={confirm?.tone}
        busy={busy}
        accent={game.accent}
        onConfirm={() => confirm?.onConfirm()}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
