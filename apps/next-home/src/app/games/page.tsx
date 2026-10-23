import type { Metadata } from 'next'
import { GameHub } from '@/components/games/GameHub'

export const metadata: Metadata = {
  title: '酒桌游戏 · 同一房间号，多台手机一起玩',
  description: '骰子吹牛、数字炸弹、七八九：手机优先的多人酒桌游戏，房间号同局，服务端摇骰防作弊。',
  openGraph: {
    title: '酒桌游戏 · zxLumen',
    description: '同一个房间号，多台手机一起玩。骰子吹牛、数字炸弹、七八九。',
  },
}

export default function GamesPage() {
  return (
    <div className="games-shell">
      <GameHub />
    </div>
  )
}

export const dynamic = 'force-dynamic'
