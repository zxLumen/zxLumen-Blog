/**
 * 服务器状态:通过 Grafana Cloud 的 Prometheus 查询接口读取关键指标(只读)。
 * 供 GET /api/status 使用;带 60s 进程内缓存,失败返回 ok:false(前端显示降级气泡)。
 */

export type StatusMetric = 'cpu' | 'mem' | 'disk' | 'load'

export interface StatusPoint {
  /** Unix 秒 */
  t: number
  v: number
}

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
  /** 近 24h 序列(15 分钟/点),供悬浮件折线图按指标切换 */
  series?: Partial<Record<StatusMetric, StatusPoint[]>>
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

/** 区间查询:返回 [{t,v}] */
async function qRange(expr: string, hours: number, step: number): Promise<StatusPoint[]> {
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
    return vals.map(([t, v]) => ({ t, v: Math.round(Number(v) * 10) / 10 }))
  } catch {
    return []
  }
}

/* ---------- 指标表达式 ---------- */

const CPU_EXPR = '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
const MEM_EXPR = '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100'
const DISK_EXPR =
  '(1 - max(node_filesystem_avail_bytes{mountpoint="/"}) / max(node_filesystem_size_bytes{mountpoint="/"})) * 100'
const LOAD_EXPR = 'max(node_load1)'

const METRIC_EXPR: Record<StatusMetric, string> = {
  cpu: CPU_EXPR,
  mem: MEM_EXPR,
  disk: DISK_EXPR,
  load: LOAD_EXPR,
}

/** 24h 曲线:15 分钟一个点(96 点/指标) */
const SERIES_HOURS = 24
const SERIES_STEP = 900

let cache: { at: number; data: ServerStatus } | null = null
const TTL = 60_000

export async function getServerStatus(): Promise<ServerStatus> {
  if (cache && Date.now() - cache.at < TTL) return cache.data
  if (!TOKEN) return { ok: false, error: 'GRAFANA_READ_TOKEN not set', at: Date.now() }

  const [cpu, mem, disk, load, boot, siteUp, cpuS, memS, diskS, loadS] = await Promise.all([
    q(METRIC_EXPR.cpu),
    q(METRIC_EXPR.mem),
    q(METRIC_EXPR.disk),
    q(METRIC_EXPR.load),
    q('max(node_boot_time_seconds)'),
    q('min(probe_success{job=~"zxlumen.*"})'),
    qRange(METRIC_EXPR.cpu, SERIES_HOURS, SERIES_STEP),
    qRange(METRIC_EXPR.mem, SERIES_HOURS, SERIES_STEP),
    qRange(METRIC_EXPR.disk, SERIES_HOURS, SERIES_STEP),
    qRange(METRIC_EXPR.load, SERIES_HOURS, SERIES_STEP),
  ])

  const ok = [cpu, mem, disk, load, boot].some((v) => v != null)
  const series: Partial<Record<StatusMetric, StatusPoint[]>> = {}
  if (cpuS.length) series.cpu = cpuS
  if (memS.length) series.mem = memS
  if (diskS.length) series.disk = diskS
  if (loadS.length) series.load = loadS

  const data: ServerStatus = ok
    ? {
        ok: true,
        cpu: cpu ?? undefined,
        mem: mem ?? undefined,
        disk: disk ?? undefined,
        load: load ?? undefined,
        uptimeSec: boot != null ? Math.max(0, Math.floor(Date.now() / 1000 - boot)) : undefined,
        siteUp: siteUp != null ? siteUp >= 1 : undefined,
        series,
        at: Date.now(),
      }
    : { ok: false, error: 'query failed', at: Date.now() }

  cache = { at: Date.now(), data }
  return data
}
