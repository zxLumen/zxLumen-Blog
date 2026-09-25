import { getServerStatus } from '@/lib/status'

export const dynamic = 'force-dynamic'

/** 服务器状态(供首页悬浮件):读 Grafana Cloud 指标,60s 缓存 */
export async function GET() {
  return Response.json(await getServerStatus(), { headers: { 'Cache-Control': 'no-store' } })
}
