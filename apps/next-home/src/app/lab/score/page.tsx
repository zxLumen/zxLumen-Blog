import { ScoreLab } from '@/components/lab/ScoreLab'
import '../creature/lab.css'
import './score.css'

export const metadata = {
  title: 'Lumen 生灵 · 打分校验台',
  robots: { index: false, follow: false },
}

export default function ScoreLabPage() {
  return <ScoreLab />
}
