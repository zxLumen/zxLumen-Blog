'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GAME_CATALOG } from '@/lib/games/catalog'
import { fetchSession } from './game-client'

export function GameHub() {
  const router = useRouter()
  const [resuming, setResuming] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const session = await fetchSession()
        if (cancelled) return
        if (session.room) {
          router.replace(`/games/${session.room.game}?room=${session.room.code}`)
          return
        }
      } catch {
        /* 没有会话就当游戏库 */
      } finally {
        if (!cancelled) setResuming(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="hub-page">
      <header className="hub-hero">
        <div className="hub-kicker">zxLumen · 酒桌</div>
        <h1>手机放桌上，<br />酒桌游戏开一局。</h1>
        <p>
          同一个房间号，多台手机同步。骰子由服务端生成，关掉页面再打开还能回到上一局。
        </p>
        <div className="hub-hero-chips">
          <span>📱 手机优先</span>
          <span>🔗 房间号同局</span>
          <span>🎲 服务端防作弊</span>
        </div>
        {resuming ? <div className="hub-resume">正在检查有没有没结束的房间…</div> : null}
      </header>

      <section className="hub-games" aria-label="游戏列表">
        {GAME_CATALOG.map((game, index) => (
          <Link
            key={game.id}
            href={game.href}
            className="hub-card"
            style={{
              '--game-accent': game.accent,
              '--hub-delay': `${index * 90}ms`,
            } as React.CSSProperties}
          >
            <span className="hub-card-emoji" aria-hidden="true">{game.emoji}</span>
            <span className="hub-card-body">
              <span className="hub-card-top">
                <b>{game.name}</b>
                <em>{game.short}</em>
              </span>
              <span className="hub-card-tagline">{game.tagline}</span>
              <span className="hub-card-desc">{game.description}</span>
              <span className="hub-card-foot">
                <span>{game.players}</span>
                <span className="hub-card-go">进入 →</span>
              </span>
            </span>
          </Link>
        ))}
      </section>

      <footer className="hub-foot">
        <span>🍺 喝多少由酒桌决定，App 只负责发牌、摇骰和记数。</span>
        <span>更多游戏陆续加入。</span>
      </footer>
    </div>
  )
}
