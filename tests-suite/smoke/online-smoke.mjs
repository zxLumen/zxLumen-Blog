import tls from 'node:tls'

/**
 * 线上**只读**冒烟:仅发 GET,不写任何数据、不压测。
 * 用法:
 *   SMOKE_BASE_URL=https://zxlumen.cn node tests-suite/smoke/online-smoke.mjs
 *   SMOKE_DOMAIN=zxlumen.cn node tests-suite/smoke/online-smoke.mjs      # 自动拼 https://
 *   SMOKE_SUBDOMAINS=todo,yijing,stock,luminari ...                       # 子应用;空串跳过
 * 退出码:0 全通过;1 有失败。
 */

const rawBase = process.env.SMOKE_BASE_URL || process.env.SMOKE_DOMAIN || ''
const BASE = rawBase
  ? rawBase.startsWith('http')
    ? rawBase.replace(/\/$/, '')
    : `https://${rawBase.replace(/\/$/, '')}`
  : ''
const HOST = BASE.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
const SUBDOMAINS = (process.env.SMOKE_SUBDOMAINS ?? 'todo,yijing,stock,luminari')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const TLS_MIN_DAYS = Number(process.env.SMOKE_TLS_MIN_DAYS || 14)
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 12000)

if (!BASE) {
  console.error('缺少 SMOKE_BASE_URL(或 SMOKE_DOMAIN),例如:SMOKE_DOMAIN=zxlumen.cn')
  process.exit(2)
}

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function get(path, expect) {
  const url = BASE + path
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal })
    const ok = expect.includes(res.status)
    return { status: res.status, ok, url }
  } catch (e) {
    return { status: 0, ok: false, url, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function tlsDays() {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert || !cert.valid_to) return resolve({ ok: false, days: null })
      const days = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000)
      resolve({ ok: days >= TLS_MIN_DAYS, days })
    })
    socket.on('error', (e) => resolve({ ok: false, days: null, error: e.message }))
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ ok: false, days: null, error: 'timeout' })
    })
  })
}

const HEADERS = { 'user-agent': 'zx-online-smoke/1.0' }

console.log(`\n== 线上只读冒烟:${BASE} ==\n`)

{
  const r = await get('/', [200])
  record('首页 200', r.ok, `status=${r.status}`)
}
{
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/api/health`, { headers: HEADERS, signal: ctrl.signal })
    const body = await res.json().catch(() => ({}))
    record('GET /api/health 200 ok', res.status === 200 && body.status === 'ok', `status=${res.status}`)
  } catch (e) {
    record('GET /api/health 200 ok', false, e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}
{
  // Caddy 公网应对 /api/metrics* 返回 404(纵深防御)
  const r = await get('/api/metrics', [404])
  record('GET /api/metrics → 404(公网不暴露)', r.ok, `status=${r.status}`)
}
{
  const { ok, days, error } = await tlsDays()
  record(`TLS 证书剩余 ≥ ${TLS_MIN_DAYS} 天`, ok, error ? error : `${days} 天`)
}

for (const sub of SUBDOMAINS) {
  const u = new URL(BASE)
  u.hostname = `${sub}.${u.hostname}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(u, { redirect: 'manual', headers: HEADERS, signal: ctrl.signal })
    record(`子应用 ${sub} 可达`, res.status < 500, `status=${res.status}`)
  } catch (e) {
    record(`子应用 ${sub} 可达`, false, e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n结果:${results.length - failed.length}/${results.length} 通过\n`)
process.exit(failed.length === 0 ? 0 : 1)
