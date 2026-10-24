'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GAME_BY_ID } from '@/lib/games/catalog'
import {
  DICE_PER_PLAYER,
  type LiarSettings,
  type LiarView,
} from '@/lib/games/liars-dice-shared'
import type { PlayerView } from '@/lib/games/types'
import { ConfirmDialog } from './ConfirmDialog'
import { CountUp } from './CountUp'
import { DiceHand, PipDie } from './Dice'
import { GameEntry } from './GameEntry'
import { PlayerList } from './PlayerList'
import { RenameDialog } from './RenameDialog'
import { RoomHeader } from './RoomHeader'
import { useGameRoom, type AnyRoomView } from './game-client'

type LiarRoom = AnyRoomView & { data: LiarView }

const FACES = [1, 2, 3, 4, 5, 6] as const

interface PendingConfirm {
  title: string
  description: React.ReactNode
  confirmText: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
}

function LeopardBadge({ kind }: { kind: 'none' | 'mixed' | 'pure' }) {
  if (kind === 'none') return null
  return (
    <span className={`ld-leopard ${kind}`}>
      {kind === 'pure' ? '纯豹 +2' : '豹子 +1'}
    </span>
  )
}

function RulesCard() {
  return (
    <details className="game-side-card ld-rules" open>
      <summary>规则速查</summary>
      <ul>
        <li>每人 5 颗骰，只看得到自己的。</li>
        <li><b>每个人自己点一次「摇骰」</b>；所有人点完才能开骰，一个人点不会替全桌摇。</li>
        <li>服务端生成，一局只能摇一次，刷新/重进不会重摇。</li>
        <li>五颗全不同（顺子）服务端自动重摇。</li>
        <li>开骰后同时给出斋 / 飞两套各点数总计，机器不判输赢。</li>
        <li>豹子：含 1 凑成五同 <b>+1</b>，五个完全相同 <b>+2</b>；房主可关。</li>
      </ul>
      <p>开骰后按你们线下的规矩看总骰数判输赢。</p>
    </details>
  )
}

function TotalsTable({ data }: { data: LiarView }) {
  const reveal = data.reveal
  if (!reveal) return null
  return (
    <div className="ld-totals-wrap">
      <div className="ld-totals-head">
        <div className="ld-total-summary">
          <span className="ld-total-big">
            <CountUp value={reveal.totalDice} />
          </span>
          <span className="ld-total-label">颗骰子在场</span>
        </div>
        <div className="ld-totals-legend">
          <span><b>斋</b> 1 不算万能</span>
          <span><b>飞</b> 1 万能</span>
        </div>
      </div>

      <div className="ld-count-grid">
        {FACES.map((face) => (
          <div className="ld-count-card" key={face}>
            <div className="ld-count-face">
              <span className={`ld-mini-face face-${face}`}>{face}</span>
              <span>{face} 点</span>
            </div>
            <div className="ld-count-values">
              <div className="zhai">
                <span>斋</span>
                <b><CountUp value={reveal.totalsZhai[face] ?? 0} duration={500} /></b>
              </div>
              <div className="fei">
                <span>飞</span>
                <b><CountUp value={reveal.totalsFei[face] ?? 0} duration={500} /></b>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="ld-totals-note">按你们这局约定的斋 / 飞口径看对应数字；App 只报数，不判输赢。</p>
    </div>
  )
}

function PlayerDiceGrid({
  room,
  data,
}: {
  room: LiarRoom
  data: LiarView
}) {
  if (!data.reveal) return null
  return (
    <div className="ld-reveal-players">
      {room.players.map((player, index) => {
        const entry = data.reveal?.playerDice.find((p) => p.playerId === player.id)
        return (
          <div
            key={player.id}
            className="ld-reveal-player"
            style={{ '--reveal-delay': `${index * 90}ms` } as React.CSSProperties}
          >
            <div className="ld-reveal-player-head">
              <span className="game-dot online" />
              <b>{player.name}</b>
              <LeopardBadge kind={data.settings.leopard ? entry?.kind ?? 'none' : 'none'} />
            </div>
            <DiceHand
              dice={entry?.dice ?? []}
              kind={data.settings.leopard ? entry?.kind : 'none'}
            />
          </div>
        )
      })}
    </div>
  )
}

function SettingsEditor({
  settings,
  onChange,
}: {
  settings: LiarSettings
  onChange: (next: LiarSettings) => void
}) {
  return (
    <div className="ld-settings">
      <div className="ld-setting-row">
        <span>豹子加成</span>
        <div className="game-seg tiny">
          <button
            type="button"
            className={settings.leopard ? 'active' : ''}
            onClick={() => onChange({ ...settings, leopard: true })}
          >
            开
          </button>
          <button
            type="button"
            className={!settings.leopard ? 'active' : ''}
            onClick={() => onChange({ ...settings, leopard: false })}
          >
            关
          </button>
        </div>
      </div>
    </div>
  )
}

export function LiarDiceGame() {
  const game = GAME_BY_ID.get('liars-dice')!
  const router = useRouter()
  const { room: rawRoom, checking, busy, error, inviteCode, create, join, act, leave, clearError } =
    useGameRoom('liars-dice')
  const room = rawRoom as LiarRoom | null
  const data = room?.data

  const [renameOpen, setRenameOpen] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [rolling, setRolling] = useState(false)
  const [revealFx, setRevealFx] = useState(false)
  const revealTimerRef = useRef<number | null>(null)
  const rollTimerRef = useRef<number | null>(null)
  const lastPhaseRef = useRef('')

  // 开骰：一次性「开！」动效。不要每次轮询都重置，所以用 ref 记相位并用独立计时器。
  useEffect(() => {
    if (!room) return
    if (room.phase === 'revealed' && lastPhaseRef.current !== 'revealed') {
      lastPhaseRef.current = room.phase
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current)
      window.setTimeout(() => setRevealFx(true), 0)
      revealTimerRef.current = window.setTimeout(() => {
        setRevealFx(false)
        revealTimerRef.current = null
      }, 1600)
      return
    }
    lastPhaseRef.current = room.phase
  }, [room])

  useEffect(
    () => () => {
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current)
      if (rollTimerRef.current) window.clearTimeout(rollTimerRef.current)
    },
    [],
  )

  if (checking) {
    return (
      <div className="game-loading">
        <span className="ld-loading-die">🎲</span>
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

  const phase = room.phase
  const isHost = room.you.isHost
  const shakenCount = data.shakenIds.length
  const playerCount = room.players.length

  const goHub = () => {
    void leave().then(() => router.push('/games'))
  }

  const scrollToTop = () => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    })
  }

  const requestLeave = () => {
    if (phase === 'lobby') {
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
      description: '如果他是不小心关掉页面，移出后他的 cookie 就回不到这局了；本局会回到大厅重新开始。',
      confirmText: '移出房间',
      tone: 'danger',
      onConfirm: () => {
        setConfirm(null)
        void act({ type: 'kick', targetId: target.id })
      },
    })
  }

  const requestLobby = () => {
    setConfirm({
      title: '回到大厅？',
      description: '本局结果会收起，回到大厅后可以等新朋友加入、再重新摇骰。已经喝掉的酒不受影响。',
      confirmText: '回大厅',
      onConfirm: () => {
        setConfirm(null)
        void act({ type: 'lobby' })
      },
    })
  }

  const shake = () => {
    if (rolling || data.yourShaken) return
    setRolling(true)
    if (rollTimerRef.current) window.clearTimeout(rollTimerRef.current)
    rollTimerRef.current = window.setTimeout(() => {
      setRolling(false)
      rollTimerRef.current = null
      // 布局从「摇骰按钮」切成「骰子」后页面高度会变，等落定后再滚一次到页首
      scrollToTop()
    }, 950)
    void act({ type: 'shake' }).then((ok) => {
      if (ok) window.setTimeout(scrollToTop, 80)
      else setRolling(false)
    })
  }

  const requestOpen = () => {
    if (!data.allShaken) return
    setConfirm({
      title: '确认开骰？',
      description: (
        <>
          <p>所有人已经摇完，开骰后立即亮出全部骰子。</p>
          <p>App 会给出总骰数、斋 / 飞两套各点数总计；输赢由你们线下判断。</p>
        </>
      ),
      confirmText: '开！',
      tone: 'danger',
      onConfirm: () => {
        setConfirm(null)
        void act({ type: 'open' }).then((ok) => {
          if (ok) scrollToTop()
        })
      },
    })
  }

  return (
    <div
      className={`game-page ld-page${revealFx ? ' reveal-fx' : ''}`}
      style={{ '--game-accent': game.accent } as React.CSSProperties}
    >
      <RoomHeader
        game={game}
        room={room}
        onRename={() => setRenameOpen(true)}
        onLeave={requestLeave}
        onBack={requestLeave}
      />

      <div className="ld-layout">
        <main className="ld-stage">
          {phase === 'lobby' ? (
            <section className="ld-lobby game-card">
              <div className="ld-lobby-hero">
                <span className="ld-big-emoji">🎲</span>
                <div>
                  <div className="ld-eyebrow">房间已就绪</div>
                  <h2>{room.code}</h2>
                  <p>把房间号告诉同桌的人；开一局后每个人都要自己点一次摇骰。</p>
                </div>
              </div>
              <div className="ld-lobby-stats">
                <span><b>{room.players.length}</b> 人在房间</span>
                <span><b>{data.totalDice}</b> 颗骰子</span>
                <span><b>{playerCount}</b> 人各摇一次</span>
              </div>
              {data.abortNote ? <div className="game-alert soft">{data.abortNote}</div> : null}
              {isHost ? (
                <>
                  <SettingsEditor
                    settings={data.settings}
                    onChange={(settings) => void act({ type: 'settings', settings })}
                  />
                  <button
                    type="button"
                    className="game-btn primary ld-start"
                    disabled={busy || room.players.length < 2}
                    onClick={() => void act({ type: 'start' })}
                  >
                    {room.players.length < 2 ? '至少 2 人才能开局' : '开一局，大家分别摇骰'}
                  </button>
                  <p className="ld-hint">开一局只建局，不会替任何人摇骰；每个人都要自己点。</p>
                </>
              ) : (
                <p className="ld-wait-host">等房主开一局…</p>
              )}
            </section>
          ) : null}

          {phase === 'shaking' ? (
            <section className="ld-table">
              <div className="ld-table-top">
                <div>
                  <div className="ld-eyebrow">第 {data.roundNo} 局 · 摇骰</div>
                  <h2>
                    {!data.yourShaken ? '该你摇' : data.allShaken ? '都摇完了' : '等其他人'}
                  </h2>
                  <p>
                    {!data.yourShaken
                      ? '点下面的「摇骰」，只能摇一次，摇完不能改。'
                      : data.allShaken
                        ? '所有人已经摇完，任意人都可以点开骰。'
                        : '你的骰子已经锁定，等其他人点完摇骰。'}
                  </p>
                </div>
                <div className="ld-total-pill">
                  <span>已摇</span>
                  <b>{shakenCount}/{playerCount}</b>
                  <span>人</span>
                </div>
              </div>

              <div className="ld-shake-progress game-card">
                <div className="ld-shake-progress-head">
                  <span>本局进度</span>
                  <b>{data.allShaken ? '全部摇完，可以开骰' : `还有 ${playerCount - shakenCount} 人没摇`}</b>
                </div>
                <div className="ld-shake-dots">
                  {room.players.map((player) => (
                    <span
                      key={player.id}
                      className={data.shakenIds.includes(player.id) ? 'done' : ''}
                      title={`${player.name}：${data.shakenIds.includes(player.id) ? '已摇' : '未摇'}`}
                    >
                      {player.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="ld-my-dice game-card">
                <div className="ld-section-head">
                  <div>
                    <span className="ld-eyebrow">你的骰子</span>
                    <h3>{room.you.name}</h3>
                  </div>
                  <LeopardBadge kind={data.settings.leopard ? data.yourKind : 'none'} />
                </div>
                {!data.yourShaken || rolling ? (
                  <div className="ld-shake-stage">
                    <div className="ld-shake-cup-row">
                      {Array.from({ length: DICE_PER_PLAYER }, (_, i) => (
                        <PipDie key={i} hidden rolling={rolling} delay={i * 55} />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="game-btn primary ld-shake-btn"
                      disabled={busy || rolling}
                      onClick={shake}
                    >
                      {rolling ? '摇骰中…' : '摇骰'}
                    </button>
                    <p className="ld-dice-note">一局只能摇一次；五颗全不同会自动重摇。</p>
                  </div>
                ) : (
                  <>
                    <DiceHand
                      dice={data.yourDice}
                      kind={data.settings.leopard ? data.yourKind : 'none'}
                    />
                    <p className="ld-dice-note">
                      {data.allShaken ? '所有人都摇完了，可以开骰。' : '已摇好，等其他人点摇骰。'}
                    </p>
                  </>
                )}
              </div>

              <div className={`ld-open-box game-card${data.allShaken ? ' ready' : ''}`}>
                <div className="ld-section-head">
                  <div>
                    <span className="ld-eyebrow">开骰</span>
                    <h3>所有人摇完后才能开</h3>
                  </div>
                  <span className={`ld-legal${data.allShaken ? ' ok' : ''}`}>
                    {data.allShaken ? '可以开骰' : `还差 ${playerCount - shakenCount} 人`}
                  </span>
                </div>
                <button
                  type="button"
                  className="game-btn danger ld-open-btn"
                  disabled={busy || !data.allShaken}
                  onClick={requestOpen}
                >
                  开骰
                </button>
                <p className="ld-confirm-note">开骰前会二次确认；开骰后亮出所有人的骰子。</p>
              </div>

              <div className="ld-cups game-card">
                <div className="ld-section-head">
                  <div>
                    <span className="ld-eyebrow">桌面</span>
                    <h3>大家的骰盅</h3>
                  </div>
                  <span className="ld-dim">{playerCount} 人 · {data.totalDice} 颗</span>
                </div>
                <div className="ld-cup-grid">
                  {room.players.map((player) => {
                    const done = data.shakenIds.includes(player.id)
                    return (
                      <div key={player.id} className={`ld-cup-player${done ? ' done' : ''}`}>
                        <div className="ld-cup-name">
                          {player.name}
                          {player.id === room.you.id ? <em>你</em> : null}
                          <span className={done ? 'shaken' : 'waiting'}>
                            {done ? '已摇' : '未摇'}
                          </span>
                        </div>
                        <div className="ld-cup-row">
                          {Array.from({ length: DICE_PER_PLAYER }, (_, i) => (
                            <span
                              key={i}
                              className={`ld-cup${!done ? ' waiting-cup' : ''}`}
                              style={{ '--cup-delay': `${i * 60}ms` } as React.CSSProperties}
                            >
                              <i />
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="ld-waiting game-card">
                <span className="ld-wait-dot" />
                <p>
                  {data.allShaken
                    ? '所有人都摇完了，等任意一个人开骰。'
                    : `已摇 ${shakenCount}/${playerCount}，等其他人自己点摇骰…`}
                </p>
                <span className="ld-dim">一个人点不会替全桌摇</span>
              </div>
            </section>
          ) : null}

          {phase === 'revealed' && data.reveal ? (
            <section className="ld-reveal">
              <div className="ld-reveal-stamp">
                <span>开</span>
                <div>
                  <b>全部骰子已亮出</b>
                  <p>
                    {room.players.find((p) => p.id === data.reveal?.openedBy)?.name ?? '有人'} 开的骰；
                    按总骰数线下判输赢。
                  </p>
                </div>
              </div>

              <TotalsTable data={data} />
              <PlayerDiceGrid room={room} data={data} />

              <div className="ld-next game-card">
                {isHost ? (
                  <div className="ld-next-actions">
                    <button
                      type="button"
                      className="game-btn primary"
                      disabled={busy}
                      onClick={() => void act({ type: 'start' })}
                    >
                      开始下一局
                    </button>
                    <button type="button" className="game-btn ghost" disabled={busy} onClick={requestLobby}>
                      回大厅（可加人）
                    </button>
                  </div>
                ) : (
                  <p className="ld-wait-host">等房主开下一局…</p>
                )}
                <p className="ld-disclaimer">
                  App 只展示总骰数和两套统计口径；最终谁输谁赢，按你们线下的判定来。
                </p>
              </div>
            </section>
          ) : null}
        </main>

        <aside className="ld-side">
          <div className="game-side-card">
            <div className="ld-side-head">
              <h3>玩家</h3>
              <span>{room.players.filter((p) => p.online).length}/{room.players.length} 在线</span>
            </div>
            <PlayerList
              room={room}
              isHost={isHost}
              onKick={requestKick}
              renderExtra={(player) => {
                if (phase !== 'shaking') return ''
                return data.shakenIds.includes(player.id) ? '已摇' : '未摇'
              }}
            />
            <p className="game-side-note">关掉页面不会退出，下次打开会凭 cookie 回到这里；离线太久可让房主移出。</p>
          </div>
          <RulesCard />
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
