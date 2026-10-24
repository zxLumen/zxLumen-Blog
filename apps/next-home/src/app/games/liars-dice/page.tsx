import type { Metadata } from 'next'
import { LiarDiceGame } from '@/components/games/LiarDiceGame'

export const metadata: Metadata = {
  title: '骰子吹牛 · 酒桌游戏',
  description: '每人自己摇一次骰，全部摇完再开骰；开骰后只看总骰数和斋/飞两套统计，输赢线下判。',
}

export default function LiarDicePage() {
  return <LiarDiceGame />
}

export const dynamic = 'force-dynamic'
