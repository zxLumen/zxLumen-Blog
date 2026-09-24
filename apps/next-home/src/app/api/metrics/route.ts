import { getDb } from '@/lib/db'
import { renderMetrics } from '@/lib/metrics'

export const dynamic = 'force-dynamic'

/** 从请求头/查询参数提取 token:支持 X-Metrics-Token、Bearer、Basic、?token= */
function extractToken(req: Request, url: URL): string {
  const header = req.headers.get('x-metrics-token')
  if (header) return header
  const auth = req.headers.get('authorization') || ''
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)
  if (bearer) return bearer[1].trim()
  const basic = /^Basic\s+(.+)$/i.exec(auth)
  if (basic) {
    try {
      const decoded = atob(basic[1])
      const i = decoded.indexOf(':')
      return i >= 0 ? decoded.slice(i + 1) : decoded
    } catch {
      /* ignore */
    }
  }
  return url.searchParams.get('token') || ''
}

/**
 * Prometheus 指标端点(仅内部抓取)。
 * 需 `X-Metrics-Token` 头 / `Authorization: Bearer|Basic` / `?token=` 匹配 METRICS_TOKEN;
 * Caddy 亦对公网屏蔽该路径。
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const expected = process.env.METRICS_TOKEN || ''
  if (!expected || extractToken(req, url) !== expected) {
    return new Response('forbidden\n', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  let business = ''
  try {
    const s = getDb().stats()
    business = [
      '# HELP zx_visits_pv 累计访问(PV)',
      '# TYPE zx_visits_pv gauge',
      `zx_visits_pv ${s.visits.pv}`,
      '# TYPE zx_visits_uv gauge',
      `zx_visits_uv ${s.visits.uv}`,
      '# TYPE zx_visits_online gauge',
      `zx_visits_online ${s.visits.online}`,
      '# TYPE zx_comments_total gauge',
      `zx_comments_total ${s.comments.total}`,
      '# TYPE zx_comments_public gauge',
      `zx_comments_public ${s.comments.publicCount}`,
      '# TYPE zx_comments_private gauge',
      `zx_comments_private ${s.comments.privateCount}`,
      '# TYPE zx_project_clicks gauge',
      `zx_project_clicks ${s.events.projectClicks}`,
      '# TYPE zx_resume_downloads gauge',
      `zx_resume_downloads ${s.events.resumeDownloads}`,
    ].join('\n')
  } catch {
    /* 数据库异常时仍返回进程指标 */
  }

  return new Response(renderMetrics(business), {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
