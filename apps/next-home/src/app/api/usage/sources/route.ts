import { getSourceAvailability } from '@/lib/usage-sources'
import { getUsageSourceOrder, getUsageDefaultSource } from '@/lib/usage-source-order'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/** 返回各源可用性(已配置 + 近30天有数据)+ admin 配置的展示顺序与默认源 */
export async function GET() {
  const d = {
    ...(await getSourceAvailability()),
    order: getUsageSourceOrder(),
    defaultSource: getUsageDefaultSource(),
  }
  return Response.json(d, { headers: noStore })
}
