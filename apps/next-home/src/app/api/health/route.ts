import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 健康检查(供 Grafana Cloud Synthetic 外部探测):验证进程与数据库可用 */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    getDb().getMeta('__health_check')
    return Response.json({ status: 'ok', ts: Date.now() }, { headers })
  } catch (e) {
    return Response.json(
      { status: 'error', error: e instanceof Error ? e.message : String(e), ts: Date.now() },
      { status: 503, headers },
    )
  }
}
