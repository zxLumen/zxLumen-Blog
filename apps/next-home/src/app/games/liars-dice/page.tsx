import type { Metadata } from 'next'
import { LiarDiceGame } from '@/components/games/LiarDiceGame'

export const metadata: Metadata = {
  title: '骰子吹牛 · 酒桌游戏',
  description: '五颗骰子，轮流叫「几个几」，斋、飞、豹子、顺子重摇。房间号同局，手机优先。',
}

export default function LiarDicePage() {
  return <LiarDiceGame />
}

export const dynamic = 'force-dynamic'
