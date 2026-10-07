import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: process.cwd(),
    include: ['tests-suite/api/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
    // 只有一个被测服务实例;串行执行避免相互干扰(限流/防抖)
    fileParallelism: false,
  },
})
