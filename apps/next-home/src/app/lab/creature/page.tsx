import { CreatureLab } from '@/components/lab/CreatureLab'
import './lab.css'

export const metadata = {
  title: 'Lumen 生灵 · 六渲染技术版',
  robots: { index: false, follow: false },
}

export default function CreatureLabPage() {
  return <CreatureLab />
}