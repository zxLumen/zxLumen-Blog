import { JudgeLab } from '@/components/lab/JudgeLab'
import '../creature/lab.css'
import './judge.css'

export const metadata = {
  title: 'Lumen 生灵 · 裁判验证台',
  robots: { index: false, follow: false },
}

export default function JudgeLabPage() {
  return <JudgeLab />
}
