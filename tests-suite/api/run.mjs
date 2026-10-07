import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * L2 接口测试编排器:
 *   1) 确保 apps/next-home 有生产构建产物(无则先 build)
 *   2) 用**临时库** + 测试密钥启动 `next start`
 *   3) 等 /api/health 就绪 → 跑 vitest(注入 BASE_URL)
 *   4) 收尾:杀进程、删临时库
 *
 * 只读线上不适用;此处全程本地、可反复重跑。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const appDir = path.join(repoRoot, 'apps/next-home')
const PORT = Number(process.env.API_TEST_PORT || 3199)
const BASE_URL = `http://127.0.0.1:${PORT}`
const dbPath = path.join(os.tmpdir(), `zx-api-test-${Date.now()}.db`)

const log = (...a) => console.log('[api-test]', ...a)

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
      const r = await fetch(`${BASE_URL}/api/health`)
      if (r.ok) return true
    } catch {
      /* 未就绪 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function main() {
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

  log(`启动 next start → ${BASE_URL}(临时库 ${dbPath})`)
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
    log('服务未在超时内就绪,退出')
    stop()
    process.exit(1)
  }
  log('服务就绪,开始跑 vitest …')

  try {
    await run('npx', ['vitest', 'run', '--config', 'tests-suite/api/vitest.config.mts'], {
      cwd: repoRoot,
      env: { ...env, ZX_TEST_BASE_URL: BASE_URL },
    })
  } finally {
    stop()
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true })
  }
}

main().catch((e) => {
  console.error('[api-test] 失败:', e)
  process.exit(1)
})
