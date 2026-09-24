/**
 * 轻量进程内指标登记(仅 Node 运行时),导出 Prometheus 文本格式。
 * 供 GET /api/metrics 使用;数值随进程重启清零,长期留存交给 Grafana Cloud。
 */

type Labels = Record<string, string>

const counters = new Map<string, { name: string; labels: Labels; value: number }>()
const startedAt = Date.now() / 1000

const escapeLabel = (v: string) =>
  String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

/** 通过 globalThis 读内存,避免 Edge 运行时静态检测到 Node API(Edge 下返回 0) */
const runtimeMem = (): { rss: number; heapUsed: number } => {
  try {
    const p = (globalThis as {
      process?: { memoryUsage?: () => { rss: number; heapUsed: number } }
    }).process
    return p?.memoryUsage?.() ?? { rss: 0, heapUsed: 0 }
  } catch {
    return { rss: 0, heapUsed: 0 }
  }
}

const labelsKey = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join('\u0000')

/** 计数器 +1 / +delta */
export function incCounter(name: string, labels: Labels = {}, delta = 1): void {
  const k = `${name}\u0000${labelsKey(labels)}`
  const cur = counters.get(k)
  if (cur) cur.value += delta
  else counters.set(k, { name, labels, value: delta })
}

/** 渲染 Prometheus 文本;`extra` 为额外的 gauge(如业务指标) */
export function renderMetrics(extra = ''): string {
  const mem = runtimeMem()
  const out: string[] = []

  out.push('# HELP zx_up 服务存活(1=正常)')
  out.push('# TYPE zx_up gauge')
  out.push('zx_up 1')

  out.push('# HELP zx_process_start_time_seconds 进程启动时间(Unix 秒)')
  out.push('# TYPE zx_process_start_time_seconds gauge')
  out.push(`zx_process_start_time_seconds ${startedAt.toFixed(0)}`)

  out.push('# HELP zx_process_resident_memory_bytes 常驻内存字节')
  out.push('# TYPE zx_process_resident_memory_bytes gauge')
  out.push(`zx_process_resident_memory_bytes ${mem.rss}`)

  out.push('# HELP zx_nodejs_heap_used_bytes Node 堆使用字节')
  out.push('# TYPE zx_nodejs_heap_used_bytes gauge')
  out.push(`zx_nodejs_heap_used_bytes ${mem.heapUsed}`)

  const byName = new Map<string, { labels: Labels; value: number }[]>()
  for (const entry of counters.values()) {
    const arr = byName.get(entry.name) ?? []
    arr.push({ labels: entry.labels, value: entry.value })
    byName.set(entry.name, arr)
  }
  for (const [name, arr] of byName) {
    out.push(`# TYPE ${name} counter`)
    for (const { labels, value } of arr) {
      const lbl = Object.keys(labels)
        .sort()
        .map((k) => `${k}="${escapeLabel(labels[k])}"`)
        .join(',')
      out.push(`${name}${lbl ? `{${lbl}}` : ''} ${value}`)
    }
  }

  if (extra) out.push(extra.replace(/\n+$/, ''))
  return out.join('\n') + '\n'
}
