import { SpeciesLab } from '@/components/lab/SpeciesLab'
import '../creature/lab.css'
import './species.css'

export const metadata = {
  title: 'Lumen 生灵',
  robots: { index: false, follow: false },
}

export default function SpeciesLabPage() {
  return <SpeciesLab />
}
