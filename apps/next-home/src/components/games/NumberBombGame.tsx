'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GAME_BY_ID } from '@/lib/games/catalog'
import type { BombView } from '@/lib/games/number-bomb-shared'
import type { PlayerView } from '@/lib/games/types'
import { ConfirmDialog } from './ConfirmDialog'
import { GameEntry } from './GameEntry'
import { PlayerList } from './PlayerList'
import { RenameDialog } from './RenameDialog'
import { RoomHeader } from './RoomHeader'
import { useGameRoom, type AnyRoomView } from './game-client'

type BombRoom = AnyRoomView & { data: BombView }

interface PendingConfirm {
  title: string
  description: React.ReactNode
  confirmText: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
}

export function NumberBombGame() {
  const game = GAME_BY_ID.get('number-bomb')!
  const router = useRouter()
  const { room: rawRoom, checking, busy, error, inviteCode, create, join, act, leave, clearError } =
    useGameRoom('number-bomb')
  const room = rawRoom as BombRoom | null
  const data = room?.data

  const [renameOpen, setRenameOpen] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [guess, setGuess] = useState('')
  const [exploding, setExploding] = useState(false)
  const lastPhase = useRef('')
  const boomTimerRef = useRef<number | null>(null)
  const minMaxKey = useRef('')
  const guessKey = useRef('')
  const [minDraft, setMinDraft] = useState('1')
  const [maxDraft, setMaxDraft] = useState('100')

  useEffect(() => {
    if (!data) return
    const key = `${data.min}:${data.max}`
    if (key === minMaxKey.current) return
    minMaxKey.current = key
    const timer = window.setTimeout(() => {
      setMinDraft(String(data.min))
      setMaxDraft(String(data.max))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [data])

  useEffect(() => {
    if (!room) return
    if (room.phase === 'exploded' && lastPhase.current !== 'exploded') {
      lastPhase.current = room.phase
      if (boomTimerRef.current) window.clearTimeout(boomTimerRef.current)
      window.setTimeout(() => setExploding(true), 0)
      boomTimerRef.current = window.setTimeout(() => {
        setExploding(false)
        boomTimerRef.current = null
      }, 1700)
      return
    }
    lastPhase.current = room.phase
  }, [room])

  useEffect(
    () => () => {
      if (boomTimerRef.current) window.clearTimeout(boomTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!data) return
    const key = `${data.turnId}:${data.low}:${data.high}`
    if (key === guessKey.current) return
    guessKey.current = key
    const timer = window.setTimeout(() => setGuess(''), 0)
    return () => window.clearTimeout(timer)
  }, [data])

  const yourTurn = !!data && data.turnId === room?.you.id
  const progress = useMemo(() => {
    if (!data) return 0
    const total = Math.max(1, data.max - data.min + 1)
    return Math.max(3, Math.min(100, (data.rangeSize / total) * 100))
  }, [data])

  if (checking) {
    return (
      <div className="game-loading">
        <span className="ld-loading-die">💣</span>
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

  const sub = (value: string) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= data.low && n <= data.high && Number.isInteger(n)
  }

  return (
    <div className={`game-page bomb-page${exploding ? ' exploding' : ''}`} style={{ '--game-accent': game.accent } as React.CSSProperties}>
      <RoomHeader game={game} room={room} onRename={() => setRenameOpen(true)} onLeave={requestLeave} onBack={requestLeave} />

      <div className="bomb-layout">
        <main className="bomb-stage">
          {room.phase === 'lobby' ? (
            <section className="game-card bomb-lobby">
              <div className="bomb-hero">
                <span className="bomb-emoji">💣</span>
                <div>
                  <div className="ld-eyebrow">数字炸弹</div>
                  <h2>房间 {room.code}</h2>
                  <p>范围越猜越小，谁踩中炸弹谁喝。</p>
                </div>
              </div>
              <div className="bomb-range-preview">
                <span>范围</span>
                <b>{data.min}</b>
                <i>—</i>
                <b>{data.max}</b>
              </div>
              {room.you.isHost ? (
                <>
                  <div className="bomb-config">
                    <label>
                      最小值
                      <input
                        type="number"
                        value={minDraft}
                        onChange={(event) => setMinDraft(event.target.value)}
                        min={0}
                        max={900}
                      />
                    </label>
                    <label>
                      最大值
                      <input
                        type="number"
                        value={maxDraft}
                        onChange={(event) => setMaxDraft(event.target.value)}
                        min={10}
                        max={999}
                      />
                    </label>
                    <button
                      type="button"
                      className="game-btn ghost"
                      disabled={busy}
                      onClick={() => void act({ type: 'config', min: Number(minDraft), max: Number(maxDraft) })}
                    >
                      保存范围
                    </button>
                  </div>
                  <button
                    type="button"
                    className="game-btn primary bomb-start"
                    disabled={busy || room.players.length < 2}
                    onClick={() => void act({ type: 'start' })}
                  >
                    {room.players.length < 2 ? '至少 2 人才能开局' : '埋下炸弹，开始'}
                  </button>
                  <p className="ld-hint">开始即随机藏一颗炸弹，不需要二次确认。</p>
                </>
              ) : (
                <p className="ld-wait-host">等房主埋炸弹…</p>
              )}
            </section>
          ) : null}

          {room.phase === 'playing' ? (
            <section className="bomb-playing">
              <div className="bomb-turn">
                <div>
                  <div className="ld-eyebrow">第 {data.guesses.length + 1} 次报数</div>
                  <h2>{yourTurn ? '轮到你' : '等对手'}</h2>
                  <p>
                    {yourTurn
                      ? `在 ${data.low}–${data.high} 之间报一个数，别踩中炸弹。`
                      : `等 ${room.players.find((p) => p.id === data.turnId)?.name ?? '对手'} 报数…`}
                  </p>
                </div>
                <div className="bomb-count">
                  <b>{data.rangeSize}</b>
                  <span>个可能</span>
                </div>
              </div>

              <div className="bomb-track game-card">
                <div className="bomb-track-labels">
                  <span>{data.low}</span>
                  <span>安全区</span>
                  <span>{data.high}</span>
                </div>
                <div className="bomb-track-bar">
                  <div className="bomb-zone" style={{ width: `${progress}%` }} />
                  <span className="bomb-spark spark-a" />
                  <span className="bomb-spark spark-b" />
                  <span className="bomb-spark spark-c" />
                </div>
                <p>炸弹藏在 {data.low}–{data.high} 之间</p>
              </div>

              {yourTurn ? (
                <form
                  className="bomb-input-card game-card"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (sub(guess) && !busy) void act({ type: 'guess', value: Number(guess) })
                  }}
                >
                  <label className="bomb-input">
                    <span>报一个数</span>
                    <input
                      type="number"
                      value={guess}
                      min={data.low}
                      max={data.high}
                      onChange={(event) => setGuess(event.target.value)}
                      placeholder={`${data.low}–${data.high}`}
                      autoFocus
                    />
                  </label>
                  <button type="button" className="game-btn ghost" onClick={() => setGuess(String(Math.floor((data.low + data.high) / 2)))}>
                    取中间
                  </button>
                  <button type="submit" className="game-btn primary" disabled={busy || !sub(guess)}>
                    报数
                  </button>
                </form>
              ) : (
                <div className="ld-waiting game-card">
                  <span className="ld-wait-dot" />
                  <p>等 <b>{room.players.find((p) => p.id === data.turnId)?.name ?? '对手'}</b> 报数…</p>
                </div>
              )}

              <div className="bomb-history game-card">
                <h3>报数记录</h3>
                {data.guesses.length === 0 ? (
                  <p className="game-side-empty">还没有人报数</p>
                ) : (
                  <ol>
                    {data.guesses.slice(-10).map((item) => (
                      <li key={item.id}>
                        <span>#{item.id}</span>
                        <b>{room.players.find((p) => p.id === item.playerId)?.name ?? '玩家'}</b>
                        <em>{item.value}</em>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>
          ) : null}

          {room.phase === 'exploded' && data.bomb !== null ? (
            <section className="bomb-result">
              <div className="bomb-boom">
                <span className="bomb-boom-emoji">💥</span>
                <div>
                  <div className="ld-eyebrow">炸弹爆炸</div>
                  <h2>{room.players.find((p) => p.id === data.loserId)?.name ?? '有人'} 踩中了 {data.bomb}</h2>
                  <p>该喝多少由酒桌决定；房主可以马上再来一局。</p>
                </div>
              </div>
              <div className="bomb-result-grid">
                <div>
                  <span>炸弹</span>
                  <b>{data.bomb}</b>
                </div>
                <div>
                  <span>范围</span>
                  <b>{data.min}–{data.max}</b>
                </div>
                <div>
                  <span>报数次数</span>
                  <b>{data.guesses.length}</b>
                </div>
              </div>
              {room.you.isHost ? (
                <div className="ld-actions">
                  <button type="button" className="game-btn primary" disabled={busy} onClick={() => void act({ type: 'start' })}>
                    再来一局
                  </button>
                  <button type="button" className="game-btn ghost" disabled={busy} onClick={() => void act({ type: 'lobby' })}>
                    回大厅
                  </button>
                </div>
              ) : (
                <p className="ld-wait-host">等房主开下一局…</p>
              )}
            </section>
          ) : null}
        </main>

        <aside className="bomb-side">
          <div className="game-side-card">
            <div className="ld-side-head">
              <h3>玩家</h3>
              <span>{room.players.filter((p) => p.online).length}/{room.players.length} 在线</span>
            </div>
            <PlayerList
              room={room}
              turnId={data.turnId}
              isHost={room.you.isHost}
              onKick={requestKick}
              renderExtra={(player) => (player.id === data.loserId ? '踩雷' : '')}
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
