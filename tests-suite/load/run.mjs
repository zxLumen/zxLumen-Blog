import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 压测编排器:用**临时库**启动生产构建,再对指定 k6 场景跑压测。
 *
 * 用法:
 *   node tests-suite/load/run.mjs quick          # S0 最小冒烟(默认)
 *   node tests-suite/load/run.mjs steady-read    # S1
 *   node tests-suite/load/run.mjs rate-limit     # S8
 *   node tests-suite/load/run.mjs --list         # 列出所有场景
 *
 * 绝不对线上压测;线上只跑只读冒烟(见 tests-suite/smoke/)。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const appDir = path.join(repoRoot, 'apps/next-home')
const PORT = Number(process.env.LOAD_PORT || 3197)
const BASE = `http://127.0.0.1:${PORT}`
const dbPath = path.join(os.tmpdir(), `zx-load-${Date.now()}.db`)

const log = (...a) => console.log('[load]', ...a)

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts })
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))))
    p.on('error', reject)
  })
}

async function waitHealth(timeoutMs = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true
    } catch {
      /* 未就绪 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function main() {
  const arg = process.argv[2] || 'quick'
  if (arg === '--list' || arg === '-l') {
    const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && f !== 'lib.js')
    log('可用场景:', files.map((f) => f.replace(/\.js$/, '')).join(', '))
    return
  }
  const script = path.join(__dirname, arg.endsWith('.js') ? arg : `${arg}.js`)
  if (!fs.existsSync(script)) {
    log(`场景不存在:${script}`)
    process.exit(1)
  }

  if (!fs.existsSync(path.join(appDir, '.next', 'BUILD_ID'))) {
    log('未发现构建产物,先执行 next build …')
    await run('npm', ['run', 'build'], { cwd: appDir })
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DB_PATH: dbPath,
    SESSION_SECRET: 'test-session-secret-0123456789',
    ADMIN_PASSWORD: 'test-admin-pass',
    REPORT_TOKEN: 'test-report',
    METRICS_TOKEN: 'test-metrics',
  }

  log(`启动 next start → ${BASE}(临时库 ${dbPath})`)
  const server = spawn(
    path.join(appDir, 'node_modules', '.bin', 'next'),
    ['start', '-H', '127.0.0.1', '-p', String(PORT)],
    { cwd: appDir, env, stdio: ['ignore', 'inherit', 'inherit'] },
  )
  const stop = () => {
    try {
      server.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  process.on('exit', stop)

  if (!(await waitHealth())) {
    log('服务未就绪,退出')
    stop()
    process.exit(1)
  }

  const k6env = [`ZX_LOAD_BASE=${BASE}`]
  for (const k of ['ZX_GATEWAY_TOKEN', 'ZX_GATEWAY_MODEL', 'ZX_STATIC_PATHS', 'ZX_SOAK_DURATION', 'ZX_SOAK_VUS']) {
    if (process.env[k]) k6env.push(`${k}=${process.env[k]}`)
  }

  try {
    log(`k6 run ${path.basename(script)}`)
    await run('k6', ['run', ...k6env.flatMap((e) => ['--env', e]), script], { cwd: repoRoot })
  } finally {
    stop()
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true })
  }
}

main().catch((e) => {
  console.error('[load] 失败:', e)
  process.exit(1)
})
