import { getSourceAvailability } from '@/lib/usage-sources'
import { getUsageSourceOrder } from '@/lib/usage-source-order'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/** 返回各源可用性(已配置 + 近30天有数据)+ admin 配置的展示顺序 */
export async function GET() {
  const d = { ...(await getSourceAvailability()), order: getUsageSourceOrder() }
  return Response.json(d, { headers: noStore })
}
