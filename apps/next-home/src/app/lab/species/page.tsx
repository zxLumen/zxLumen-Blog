import { SpeciesLab } from '@/components/lab/SpeciesLab'
import '../creature/lab.css'
import './species.css'

export const metadata = {
  title: '物种实验室',
  robots: { index: false, follow: false },
}

export default function SpeciesLabPage() {
  return <SpeciesLab />
}
