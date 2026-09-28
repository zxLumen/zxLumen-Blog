import type { Instrumentation } from 'next'

/** Next 服务器启动时调用一次;按运行时初始化 Sentry(未配 DSN 则空操作) */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
    // 问候语定时生成(启动预热 + 每 60s 检查时段切换);失败不影响启动
    try {
      const { startGreetingScheduler } = await import('./lib/chat/scheduler')
      startGreetingScheduler()
    } catch (e) {
      console.warn('[greeting] scheduler start failed:', e instanceof Error ? e.message : String(e))
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

/** 服务端错误:本地计数(→ /api/metrics)+ 上报 Sentry(已配置时) */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const path = (request as { path?: string })?.path ?? 'unknown'
  const route = ((context as { routePath?: string })?.routePath ?? path).split('?')[0]

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { incCounter } = await import('./lib/metrics')
    incCounter('zx_app_errors_total', { route })
  }

  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/nextjs')
    Sentry.withScope((scope) => {
      scope.setTag('route', route)
      Sentry.captureException(err)
    })
  }
}
