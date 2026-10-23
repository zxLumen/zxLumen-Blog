'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { GameCatalogItem } from '@/lib/games/catalog'

interface GameEntryProps {
  game: GameCatalogItem
  defaultCode?: string
  busy: boolean
  error: string
  onCreate: (name: string) => void
  onJoin: (code: string, name: string) => void
  onClearError: () => void
}

/**
 * 进房页：设置昵称（可留空随机）+ 开房/用房间号加入。
 * 昵称留空时由服务端生成不重复的随机昵称，进房后右上角能看到「你是 xxx」。
 */
export function GameEntry({
  game,
  defaultCode = '',
  busy,
  error,
  onCreate,
  onJoin,
  onClearError,
}: GameEntryProps) {
  const [mode, setMode] = useState<'create' | 'join'>(defaultCode ? 'join' : 'create')
  const [name, setName] = useState('')
  const [code, setCode] = useState(defaultCode)

  const cleanCode = useMemo(() => code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5), [code])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (mode === 'create') onCreate(name)
    else onJoin(cleanCode, name)
  }

  return (
    <div className="game-entry" style={{ '--game-accent': game.accent } as React.CSSProperties}>
      <div className="game-entry-hero">
        <Link href="/games" className="game-back">
          ← 酒桌游戏
        </Link>
        <div className="game-entry-emoji">
          <span>{game.emoji}</span>
        </div>
        <div className="game-entry-kicker">{game.short} · {game.players}</div>
        <h1>{game.name}</h1>
        <p>{game.tagline}</p>
        <div className="game-entry-orbit" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>

      <div className="game-entry-panel">
        <div className="game-seg" role="tablist" aria-label="开房或加入">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'active' : ''}
            onClick={() => {
              setMode('create')
              onClearError()
            }}
          >
            开一局
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={mode === 'join' ? 'active' : ''}
            onClick={() => {
              setMode('join')
              onClearError()
            }}
          >
            加入房间
          </button>
        </div>

        <form className="game-entry-form" onSubmit={submit}>
          {mode === 'join' ? (
            <label className="game-field">
              <span>房间号</span>
              <input
                value={cleanCode}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="例如 7K3QZ"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={5}
                inputMode="text"
                required
              />
              <em>5 位字母 / 数字，问一下先到的人</em>
            </label>
          ) : null}

          <label className="game-field">
            <span>你的昵称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="留空就随机分配一个"
              maxLength={12}
              autoComplete="nickname"
            />
            <em>最多 12 个字；进房后也能改</em>
          </label>

          {error ? (
            <div className="game-alert" role="alert">
              {error}
              <button type="button" onClick={onClearError} aria-label="关闭提示">
                ×
              </button>
            </div>
          ) : null}

          <button type="submit" className="game-btn primary game-entry-submit" disabled={busy}>
            {busy ? '连接中…' : mode === 'create' ? '开房，等人来' : '进入房间'}
          </button>
        </form>

        <div className="game-entry-note">
          <span>🔗</span>
          <p>同一局的人用同一个房间号进来；房主可以移出离线或进错房的人。</p>
        </div>
      </div>

      <div className="game-entry-rules">
        <h2>这局的规矩</h2>
        <ul>
          {game.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
