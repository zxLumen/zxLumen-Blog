/**
 * 服务器状态:通过 Grafana Cloud 的 Prometheus 查询接口读取关键指标(只读)。
 * 供 GET /api/status 使用;带 60s 进程内缓存,失败返回 ok:false(前端隐藏)。
 */

export interface ServerStatus {
  ok: boolean
  /** CPU 使用率 % */
  cpu?: number
  /** 内存使用率 % */
  mem?: number
  /** 根分区使用率 % */
  disk?: number
  /** 1 分钟负载 */
  load?: number
  /** 运行时长(秒) */
  uptimeSec?: number
  /** 站点探测是否全部正常 */
  siteUp?: boolean
  /** 近 7 天 CPU 日均(%) */
  trend?: { day: string; cpu: number }[]
  at?: number
  error?: string
}

const PROM = (
  process.env.GRAFANA_PROM_URL || 'https://prometheus-prod-37-prod-ap-southeast-1.grafana.net/api/prom'
).replace(/\/+$/, '')
const USER = process.env.GRAFANA_PROM_USER || '3609734'
const TOKEN = process.env.GRAFANA_READ_TOKEN || ''

const authHeader = () => 'Basic ' + Buffer.from(`${USER}:${TOKEN}`).toString('base64')

/** 即时查询:返回首个结果值 */
async function q(expr: string): Promise<number | null> {
  try {
    const res = await fetch(`${PROM}/api/v1/query?query=${encodeURIComponent(expr)}`, {
      headers: { Authorization: authHeader() },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { data?: { result?: Array<{ value?: [number, string] }> } }
    const v = j.data?.result?.[0]?.value?.[1]
    return v == null ? null : Number(v)
  } catch {
    return null
  }
}

/** 区间查询:返回 [时间戳, 值][] */
async function qRange(expr: string, hours: number, step: number): Promise<[number, number][]> {
  try {
    const end = Math.floor(Date.now() / 1000)
    const start = end - hours * 3600
    const url = `${PROM}/api/v1/query_range?query=${encodeURIComponent(expr)}&start=${start}&end=${end}&step=${step}`
    const res = await fetch(url, {
      headers: { Authorization: authHeader() },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const j = (await res.json()) as { data?: { result?: Array<{ values?: [number, string][] }> } }
    const vals = j.data?.result?.[0]?.values ?? []
    return vals.map(([t, v]) => [t, Number(v)] as [number, number])
  } catch {
    return []
  }
}

/** 北京日 YYYY-MM-DD */
const bjDay = (t: number) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10)

/** 把小时级点聚合成近 N 天「CPU 日均」 */
function trendByDay(points: [number, number][], days = 7): { day: string; cpu: number }[] {
  const map = new Map<string, { sum: number; n: number }>()
  for (const [t, v] of points) {
    const k = bjDay(t)
    const cur = map.get(k) ?? { sum: 0, n: 0 }
    cur.sum += v
    cur.n += 1
    map.set(k, cur)
  }
  const now = Math.floor(Date.now() / 1000)
  const out: { day: string; cpu: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const k = bjDay(now - i * 86400)
    const e = map.get(k)
    out.push({ day: k, cpu: e && e.n ? Math.round((e.sum / e.n) * 10) / 10 : 0 })
  }
  return out
}

const CPU_EXPR = '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'

let cache: { at: number; data: ServerStatus } | null = null
const TTL = 60_000

export async function getServerStatus(): Promise<ServerStatus> {
  if (cache && Date.now() - cache.at < TTL) return cache.data
  if (!TOKEN) return { ok: false, error: 'GRAFANA_READ_TOKEN not set', at: Date.now() }

  const [cpu, mem, disk, load, boot, siteUp, trendPts] = await Promise.all([
    q(CPU_EXPR),
    q('(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100'),
    q('(1 - max(node_filesystem_avail_bytes{mountpoint="/"}) / max(node_filesystem_size_bytes{mountpoint="/"})) * 100'),
    q('max(node_load1)'),
    q('max(node_boot_time_seconds)'),
    q('min(probe_success{job=~"zxlumen.*"})'),
    qRange(CPU_EXPR, 168, 3600),
  ])

  const ok = [cpu, mem, disk, load, boot].some((v) => v != null)
  const data: ServerStatus = ok
    ? {
        ok: true,
        cpu: cpu ?? undefined,
        mem: mem ?? undefined,
        disk: disk ?? undefined,
        load: load ?? undefined,
        uptimeSec: boot != null ? Math.max(0, Math.floor(Date.now() / 1000 - boot)) : undefined,
        siteUp: siteUp != null ? siteUp >= 1 : undefined,
        trend: trendByDay(trendPts),
        at: Date.now(),
      }
    : { ok: false, error: 'query failed', at: Date.now() }

  cache = { at: Date.now(), data }
  return data
}
