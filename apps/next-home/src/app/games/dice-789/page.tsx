import type { Metadata } from 'next'
import { Dice789Game } from '@/components/games/Dice789Game'

export const metadata: Metadata = {
  title: '七八九 · 酒桌游戏',
  description: '两颗骰子轮流传公杯：7 加酒，8 喝一半，9 喝光，对子反转。房间号同局，手机优先。',
}

export default function Dice789Page() {
  return <Dice789Game />
}

export const dynamic = 'force-dynamic'
