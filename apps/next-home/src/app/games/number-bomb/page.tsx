import type { Metadata } from 'next'
import { NumberBombGame } from '@/components/games/NumberBombGame'

export const metadata: Metadata = {
  title: '数字炸弹 · 酒桌游戏',
  description: '轮流报数，范围越缩越小，谁踩中炸弹谁喝。房间号同局，手机优先。',
}

export default function NumberBombPage() {
  return <NumberBombGame />
}

export const dynamic = 'force-dynamic'
