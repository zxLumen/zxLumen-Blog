import { CreatureLab } from '@/components/lab/CreatureLab'
import './lab.css'

export const metadata = {
  title: '生物渲染实验室',
  robots: { index: false, follow: false },
}

export default function CreatureLabPage() {
  return <CreatureLab />
}