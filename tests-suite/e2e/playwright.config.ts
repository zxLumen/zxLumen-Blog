import { defineConfig } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

/**
 * L3 端到端测试配置。
 * Playwright 自己拉起生产构建(临时库),测试结束自动关闭。
 * 只跑本地;线上只做只读冒烟(见 docs/TESTING.md §11)。
 */
const PORT = Number(process.env.E2E_PORT || 3198)
const dbPath = path.join(os.tmpdir(), `zx-e2e-${Date.now()}.db`)
const appDir = path.resolve(__dirname, '../../apps/next-home')

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node_modules/.bin/next start -H 127.0.0.1 -p ${PORT}`,
    cwd: appDir,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      DB_PATH: dbPath,
      SESSION_SECRET: 'test-session-secret-0123456789',
      ADMIN_PASSWORD: 'test-admin-pass',
      REPORT_TOKEN: 'test-report',
      METRICS_TOKEN: 'test-metrics',
    },
  },
})
