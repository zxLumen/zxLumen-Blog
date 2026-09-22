import { getSourceAvailability } from '@/lib/usage-sources'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/** 返回各源可用性(已配置 + 近30天有数据),供面板隐藏空源 */
export async function GET() {
  return Response.json(await getSourceAvailability(), { headers: noStore })
}
