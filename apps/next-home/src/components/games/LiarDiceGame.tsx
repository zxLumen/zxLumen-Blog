'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GAME_BY_ID } from '@/lib/games/catalog'
import {
  DICE_PER_PLAYER,
  bidLabel,
  checkBid,
  type BidMode,
  type LiarView,
  type LiarSettings,
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
        <li>每人 5 颗骰，只看得到自己的；一局只摇一次，刷新也不会重摇。</li>
        <li><b>飞</b>：1 点万能；<b>斋</b>：1 只算 1，且 1 点最大。</li>
        <li>斋转飞要双倍或 +2（房主在大厅可设）；飞转斋可少 1 个。</li>
        <li>豹子：含 1 凑成五同 <b>+1</b>，五个完全相同 <b>+2</b>。</li>
        <li>五颗全不同（顺子）服务端自动重摇，摇完直接开始叫骰。</li>
        <li>开骰后实际数量 ≥ 叫数 → 叫骰成立，开的人输；否则叫的人输。</li>
      </ul>
      <p>开骰结果只做参考，最终按你们线下的规矩判。</p>
    </details>
  )
}

function BidHistory({ data }: { data: LiarView }) {
  const bids = data.bids
  if (bids.length === 0) {
    return (
      <div className="game-side-card">
        <h3>叫骰记录</h3>
        <p className="game-side-empty">还没有人叫骰</p>
      </div>
    )
  }
  return (
    <div className="game-side-card">
      <h3>叫骰记录</h3>
      <ol className="ld-history">
        {bids.slice(-8).map((bid) => (
          <li key={bid.id} className={bid.id === data.currentBid?.id ? 'current' : ''}>
            <span>#{bid.id}</span>
            <b>{bidLabel(bid)}</b>
          </li>
        ))}
      </ol>
    </div>
  )
}

function TotalsTable({ data }: { data: LiarView }) {
  const reveal = data.reveal
  if (!reveal) return null
  const activeMode = reveal.bid.mode
  return (
    <div className="ld-totals-wrap">
      <div className="ld-totals-head">
        <div>
          <span className="ld-total-big">
            <CountUp value={reveal.totalDice} />
          </span>
          <span>颗骰子在场</span>
        </div>
        <div className="ld-totals-legend">
          <span className={activeMode === 'zhai' ? 'active' : ''}>斋 · 1 不算万能</span>
          <span className={activeMode === 'fei' ? 'active' : ''}>飞 · 1 万能</span>
        </div>
      </div>
      <table className="ld-totals">
        <thead>
          <tr>
            <th>点数</th>
            <th className={activeMode === 'zhai' ? 'active' : ''}>斋</th>
            <th className={activeMode === 'fei' ? 'active' : ''}>飞</th>
          </tr>
        </thead>
        <tbody>
          {FACES.map((face) => (
            <tr key={face} className={reveal.bid.face === face ? 'target' : ''}>
              <td>
                <span className={`ld-mini-face face-${face}`}>{face}</span>
                {reveal.bid.face === face ? <em>叫点</em> : null}
              </td>
              <td className={activeMode === 'zhai' ? 'active' : ''}>
                <CountUp value={reveal.totalsZhai[face] ?? 0} duration={500} />
              </td>
              <td className={activeMode === 'fei' ? 'active' : ''}>
                <CountUp value={reveal.totalsFei[face] ?? 0} duration={500} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const reveal = data.reveal
  if (!reveal) return null
  return (
    <div className="ld-reveal-players">
      {room.players.map((player, index) => {
        const entry = reveal.playerDice.find((p) => p.playerId === player.id)
        const isOpener = reveal.openerId === player.id
        const isBidder = reveal.bidderId === player.id
        return (
          <div
            key={player.id}
            className={`ld-reveal-player${reveal.loserId === player.id ? ' loser' : ''}${isOpener ? ' opener' : ''}${isBidder ? ' bidder' : ''}`}
            style={{ '--reveal-delay': `${index * 90}ms` } as React.CSSProperties}
          >
            <div className="ld-reveal-player-head">
              <span className="game-dot online" />
              <b>{player.name}</b>
              {isOpener ? <em className="ld-tag opener">开骰</em> : null}
              {isBidder ? <em className="ld-tag bidder">被开</em> : null}
              {reveal.loserId === player.id ? <em className="ld-tag loser">输</em> : null}
              <LeopardBadge kind={entry?.kind ?? 'none'} />
            </div>
            <DiceHand dice={entry?.dice ?? []} kind={entry?.kind} />
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
        <span>起叫</span>
        <div className="game-seg tiny">
          <button
            type="button"
            className={settings.startCount === 'players' ? 'active' : ''}
            onClick={() => onChange({ ...settings, startCount: 'players' })}
          >
            按人数
          </button>
          <button
            type="button"
            className={settings.startCount === 'two' ? 'active' : ''}
            onClick={() => onChange({ ...settings, startCount: 'two' })}
          >
            2 个起
          </button>
        </div>
      </div>
      <div className="ld-setting-row">
        <span>斋转飞</span>
        <div className="game-seg tiny">
          <button
            type="button"
            className={settings.zhaiToFei === 'double' ? 'active' : ''}
            onClick={() => onChange({ ...settings, zhaiToFei: 'double' })}
          >
            双倍
          </button>
          <button
            type="button"
            className={settings.zhaiToFei === 'plus2' ? 'active' : ''}
            onClick={() => onChange({ ...settings, zhaiToFei: 'plus2' })}
          >
            +2
          </button>
        </div>
      </div>
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
  const roundRef = useRef(0)
  const lastPhaseRef = useRef('')
  const lastDraftKeyRef = useRef('')
  const rollTimerRef = useRef<number | null>(null)
  const revealTimerRef = useRef<number | null>(null)

  const [q, setQ] = useState(2)
  const [face, setFace] = useState(2)
  const [mode, setMode] = useState<BidMode>('fei')
  const bidBoxRef = useRef<HTMLDivElement | null>(null)

  const prevBid = data?.currentBid ?? null
  const yourTurn = !!data && data.turnId === room?.you.id
  const check = useMemo(
    () => checkBid(prevBid, { q, face, mode }, data?.settings ?? { startCount: 'players', zhaiToFei: 'double', leopard: true }, room?.players.length ?? 2),
    [data?.settings, face, mode, prevBid, q, room?.players.length],
  )

  // 新一轮：摇骰动画。不是轮询到旧状态也播，只在 roundNo 变化时触发。
  useEffect(() => {
    if (!room || !data) return
    if (data.roundNo > 0 && data.roundNo !== roundRef.current) {
      roundRef.current = data.roundNo
      if (room.phase === 'bidding') {
        if (rollTimerRef.current) window.clearTimeout(rollTimerRef.current)
        window.setTimeout(() => setRolling(true), 0)
        rollTimerRef.current = window.setTimeout(() => {
          setRolling(false)
          rollTimerRef.current = null
        }, 1150)
      }
    }
  }, [data, room])

  // 开骰：一次性「开！」动效
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

  // 卸载时清掉动画计时器
  useEffect(
    () => () => {
      if (rollTimerRef.current) window.clearTimeout(rollTimerRef.current)
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current)
    },
    [],
  )

  // 手机端轮到自己时，把操作面板滚进视野（只滚一次，不跟轮询反复抢滚动）
  useEffect(() => {
    if (!yourTurn || room?.phase !== 'bidding') return
    if (window.innerWidth >= 860) return
    const timer = window.setTimeout(() => {
      bidBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 420)
    return () => window.clearTimeout(timer)
  }, [room?.phase, yourTurn])

  // 轮到自己的时候，把叫骰草稿重置成一个合法的「下一口」
  useEffect(() => {
    if (!data || !room) return
    const key = `${data.currentBid?.id ?? 'none'}:${data.turnId ?? 'none'}`
    if (key === lastDraftKeyRef.current) return
    lastDraftKeyRef.current = key
    const timer = window.setTimeout(() => {
      const prev = data.currentBid
      if (!prev) {
        setMode('fei')
        setQ(data.minStart)
        setFace(2)
        return
      }
      const nextMode: BidMode = prev.mode
      let nextFace = prev.face
      let nextQ = prev.q
      if (prev.mode === 'zhai') {
        if (prev.face < 6) nextFace = prev.face + 1
        else if (prev.face === 6) nextFace = 1
        else {
          nextFace = 2
          nextQ = prev.q + 1
        }
      } else {
        if (prev.face < 6) nextFace = prev.face + 1
        else {
          nextFace = 2
          nextQ = prev.q + 1
        }
      }
      setMode(nextMode)
      setQ(nextQ)
      setFace(nextFace)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [data, room])

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

  const yourDice = data.yourDice
  const phase = room.phase
  const total = data.totalDice

  const changeMode = (nextMode: BidMode) => {
    setMode(nextMode)
    if (nextMode === 'zhai') {
      setFace((current) => (current === 1 ? 1 : current))
      if (prevBid?.mode === 'fei') {
        setQ(Math.max(2, prevBid.q))
        setFace(1)
      }
    } else {
      setFace((current) => (current === 1 ? 2 : current))
      if (prevBid?.mode === 'zhai') {
        setQ(
          data.settings.zhaiToFei === 'double'
            ? Math.max(2, prevBid.q * 2)
            : Math.max(2, prevBid.q + 2),
        )
        setFace(2)
      }
    }
  }

  const chooseFace = (nextFace: number) => {
    setFace(nextFace)
    if (nextFace === 1) setMode('zhai')
  }

  const submitBid = () => {
    if (!check.ok || !yourTurn) return
    const candidate = { q, face, mode: check.mode }
    const special = check.mode === 'zhai' || prevBid?.mode === 'zhai'
    if (!special) {
      void act({ type: 'bid', ...candidate })
      return
    }
    setConfirm({
      title: check.mode === 'zhai' ? '确认叫斋？' : '确认飞（破斋）？',
      description: (
        <>
          <p>
            你将叫 <b>{q} 个 {face}</b>，模式 <b>{check.mode === 'zhai' ? '斋' : '飞'}</b>。
          </p>
          <p>
            {check.mode === 'zhai'
              ? '斋：1 点不再万能，只按实际点数计算；1 点成为最大点。'
              : '飞：解除斋，1 点恢复万能；这手叫数已经按斋转飞的门槛校验过。'}
          </p>
        </>
      ),
      confirmText: check.mode === 'zhai' ? '确认叫斋' : '确认飞',
      onConfirm: () => {
        setConfirm(null)
        void act({ type: 'bid', ...candidate })
      },
    })
  }

  const submitOpen = () => {
    if (!prevBid || !yourTurn) return
    setConfirm({
      title: '确认开骰？',
      description: (
        <>
          <p>
            开 <b>{bidLabel(prevBid)}</b>。开骰后本局立即结束，亮出所有人的骰子。
          </p>
          <p>叫骰成立 → 开骰的人输；叫骰不成立 → 被开的人输。开完就不能再改口了。</p>
        </>
      ),
      confirmText: '开！',
      tone: 'danger',
      onConfirm: () => {
        setConfirm(null)
        void act({ type: 'open' })
      },
    })
  }

  const goHub = () => {
    void leave().then(() => router.push('/games'))
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
                  <p>把房间号告诉同桌的人，等大家进来就可以开摇。</p>
                </div>
              </div>
              <div className="ld-lobby-stats">
                <span><b>{room.players.length}</b> 人在房间</span>
                <span><b>{total}</b> 颗骰子</span>
                <span><b>{data.minStart}</b> 个起叫</span>
              </div>
              {data.abortNote ? <div className="game-alert soft">{data.abortNote}</div> : null}
              {room.you.isHost ? (
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
                    {room.players.length < 2 ? '至少 2 人才能开局' : '开始摇骰'}
                  </button>
                  <p className="ld-hint">摇骰不需要确认；一局只摇一次，服务端生成，刷新也不会变。</p>
                </>
              ) : (
                <p className="ld-wait-host">等房主开始摇骰…</p>
              )}
            </section>
          ) : null}

          {phase === 'bidding' ? (
            <section className="ld-table">
              <div className="ld-table-top">
                <div>
                  <div className="ld-eyebrow">第 {data.roundNo} 局</div>
                  <h2>{yourTurn ? '轮到你' : '等对手'}</h2>
                  <p>
                    {yourTurn
                      ? '叫一个更大的数，或者直接开上家。'
                      : `等 ${room.players.find((p) => p.id === data.turnId)?.name ?? '对手'} 叫骰或开骰。`}
                  </p>
                </div>
                <div className="ld-total-pill">
                  <span>场上</span>
                  <b>{total}</b>
                  <span>颗</span>
                </div>
              </div>

              {prevBid ? (
                <div className={`ld-current-bid${yourTurn ? ' hot' : ''}`}>
                  <div>
                    <span className="ld-bid-by">
                      {room.players.find((p) => p.id === prevBid.playerId)?.name ?? '玩家'} 叫
                    </span>
                    <strong>{bidLabel(prevBid)}</strong>
                  </div>
                  <span className={`ld-mode-badge ${prevBid.mode}`}>
                    {prevBid.mode === 'zhai' ? '斋 · 1 不万能' : '飞 · 1 万能'}
                  </span>
                </div>
              ) : (
                <div className="ld-current-bid empty">
                  <div>
                    <span className="ld-bid-by">还没有人叫骰</span>
                    <strong>本局由 {room.players.find((p) => p.id === data.starterId)?.name ?? '玩家'} 先叫</strong>
                  </div>
                </div>
              )}

              <div className="ld-my-dice game-card">
                <div className="ld-section-head">
                  <div>
                    <span className="ld-eyebrow">你的骰子</span>
                    <h3>{room.you.name}</h3>
                  </div>
                  <LeopardBadge kind={data.settings.leopard ? data.yourKind : 'none'} />
                </div>
                {rolling ? (
                  <div className="ld-rolling">
                    <DiceHand dice={[]} rolling />
                    <p>摇骰中… 一局只摇这一次</p>
                  </div>
                ) : (
                  <DiceHand dice={yourDice} kind={data.settings.leopard ? data.yourKind : 'none'} />
                )}
                <p className="ld-dice-note">
                  {data.settings.leopard
                    ? '豹子已计入开骰统计；五颗全不同会自动重摇。'
                    : '本房关闭了豹子加成；五颗全不同会自动重摇。'}
                </p>
              </div>

              <div className="ld-cups game-card">
                <div className="ld-section-head">
                  <div>
                    <span className="ld-eyebrow">桌面</span>
                    <h3>其他玩家的骰盅</h3>
                  </div>
                  <span className="ld-dim">{room.players.length} 人 · {total} 颗</span>
                </div>
                <div className="ld-cup-grid">
                  {room.players.map((player) => (
                    <div key={player.id} className={`ld-cup-player${player.id === data.turnId ? ' turn' : ''}`}>
                      <div className="ld-cup-name">
                        {player.name}
                        {player.id === room.you.id ? <em>你</em> : null}
                        {player.id === data.turnId ? <span>叫骰中</span> : null}
                      </div>
                      <div className="ld-cup-row">
                        {player.id === room.you.id
                          ? Array.from({ length: DICE_PER_PLAYER }, (_, i) => (
                              <PipDie
                                key={i}
                                value={yourDice[i]}
                                hidden={rolling}
                                rolling={rolling}
                                delay={i * 55}
                                kind={data.settings.leopard ? data.yourKind : 'none'}
                              />
                            ))
                          : Array.from({ length: DICE_PER_PLAYER }, (_, i) => (
                              <span
                                key={i}
                                className={`ld-cup${rolling ? ' shaking' : ''}`}
                                style={{ '--cup-delay': `${i * 60}ms` } as React.CSSProperties}
                              >
                                <i />
                              </span>
                            ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {yourTurn ? (
                <div ref={bidBoxRef} className="ld-bid-box game-card">
                  <div className="ld-section-head">
                    <div>
                      <span className="ld-eyebrow">你的操作</span>
                      <h3>叫骰 / 开骰</h3>
                    </div>
                    <span className={`ld-legal${check.ok ? ' ok' : ''}`}>
                      {check.ok ? '合法叫法' : check.reason}
                    </span>
                  </div>

                  <div className="ld-bid-controls">
                    <div className="ld-mode-switch">
                      <button
                        type="button"
                        className={mode === 'fei' ? 'active fei' : ''}
                        onClick={() => changeMode('fei')}
                      >
                        <b>飞</b>
                        <span>1 万能</span>
                      </button>
                      <button
                        type="button"
                        className={mode === 'zhai' ? 'active zhai' : ''}
                        onClick={() => changeMode('zhai')}
                      >
                        <b>斋</b>
                        <span>1 只算 1</span>
                      </button>
                    </div>

                    <div className="ld-qty">
                      <span>数量</span>
                      <div>
                        <button type="button" onClick={() => setQ((n) => Math.max(1, n - 1))} aria-label="减少数量">−</button>
                        <b>{q}</b>
                        <button type="button" onClick={() => setQ((n) => Math.min(99, n + 1))} aria-label="增加数量">+</button>
                      </div>
                    </div>

                    <div className="ld-face-grid">
                      {FACES.map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`ld-face-btn${face === n ? ' active' : ''}${n === 1 ? ' one' : ''}`}
                          onClick={() => chooseFace(n)}
                        >
                          <span className={`ld-mini-face face-${n}`}>{n}</span>
                          {n === 1 ? <em>最大</em> : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ld-bid-preview">
                    你要叫：<b>{bidLabel({ q, face, mode: check.mode })}</b>
                    {!check.ok ? <em>{check.reason}</em> : null}
                  </div>

                  <div className="ld-actions">
                    <button
                      type="button"
                      className="game-btn primary"
                      disabled={busy || !check.ok}
                      onClick={submitBid}
                    >
                      叫骰
                    </button>
                    <button
                      type="button"
                      className="game-btn danger"
                      disabled={busy || !prevBid}
                      onClick={submitOpen}
                    >
                      开骰
                    </button>
                  </div>
                  <p className="ld-confirm-note">斋、飞、开都需要二次确认。</p>
                </div>
              ) : (
                <div className="ld-waiting game-card">
                  <span className="ld-wait-dot" />
                  <p>等 <b>{room.players.find((p) => p.id === data.turnId)?.name ?? '对手'}</b> 叫骰…</p>
                  <span className="ld-dim">你的骰子已经锁定，本局不能重摇</span>
                </div>
              )}
            </section>
          ) : null}

          {phase === 'revealed' && data.reveal ? (
            <section className="ld-reveal">
              <div className={`ld-reveal-stamp${data.reveal.success ? ' success' : ' fail'}`}>
                <span>开</span>
                <div>
                  <b>{data.reveal.success ? '叫骰成立' : '叫骰不成立'}</b>
                  <p>
                    {data.reveal.success
                      ? `开骰的 ${room.players.find((p) => p.id === data.reveal?.openerId)?.name} 输`
                      : `叫骰的 ${room.players.find((p) => p.id === data.reveal?.bidderId)?.name} 输`}
                  </p>
                </div>
              </div>

              <div className="ld-reveal-bid game-card">
                <div>
                  <span className="ld-eyebrow">本局叫数</span>
                  <strong>{bidLabel(data.reveal.bid)}</strong>
                </div>
                <div>
                  <span className="ld-eyebrow">实际数量（{data.reveal.bid.mode === 'zhai' ? '斋' : '飞'}）</span>
                  <strong className="ld-actual">
                    <CountUp value={data.reveal.actual} /> 个
                  </strong>
                </div>
                <div>
                  <span className="ld-eyebrow">判定</span>
                  <strong className={data.reveal.success ? 'ld-win' : 'ld-lose'}>
                    {data.reveal.actual} {data.reveal.success ? '≥' : '<'} {data.reveal.bid.q}
                  </strong>
                </div>
              </div>

              <TotalsTable data={data} />
              <PlayerDiceGrid room={room} data={data} />

              <div className="ld-next game-card">
                {room.you.isHost ? (
                  <NextRoundControls
                    room={room}
                    data={data}
                    busy={busy}
                    onStart={(starterId) => void act({ type: 'start', starterId })}
                    onLobby={requestLobby}
                  />
                ) : (
                  <p className="ld-wait-host">等房主开下一局…</p>
                )}
                <p className="ld-disclaimer">
                  以上是机器按本房规则算出的参考结果；最终谁喝、谁赢，按你们线下的判定来。
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
              turnId={data.turnId}
              isHost={room.you.isHost}
              onKick={requestKick}
              renderExtra={(player) =>
                phase === 'revealed' && data.reveal
                  ? data.reveal.loserId === player.id
                    ? '本局输家'
                    : ''
                  : ''
              }
            />
            <p className="game-side-note">关掉页面不会退出，下次打开会凭 cookie 回到这里；离线太久可让房主移出。</p>
          </div>
          {phase === 'bidding' ? <BidHistory data={data} /> : null}
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

function NextRoundControls({
  room,
  data,
  busy,
  onStart,
  onLobby,
}: {
  room: LiarRoom
  data: LiarView
  busy: boolean
  onStart: (starterId: string) => void
  onLobby: () => void
}) {
  const defaultStarter = data.reveal?.loserId ?? room.players[0]?.id ?? ''
  const [starterId, setStarterId] = useState(defaultStarter)

  return (
    <div className="ld-next-controls">
      <div>
        <span className="ld-eyebrow">下一局先叫</span>
        <select value={starterId} onChange={(event) => setStarterId(event.target.value)}>
          {room.players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}{player.id === data.reveal?.loserId ? '（上局输家）' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="ld-next-actions">
        <button type="button" className="game-btn primary" disabled={busy} onClick={() => onStart(starterId)}>
          摇骰，开下一局
        </button>
        <button type="button" className="game-btn ghost" disabled={busy} onClick={onLobby}>
          回大厅（可加人）
        </button>
      </div>
    </div>
  )
}
