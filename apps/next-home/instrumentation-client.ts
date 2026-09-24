import * as Sentry from '@sentry/nextjs'

// 客户端 DSN 需在构建期注入(NEXT_PUBLIC_*),未提供则关闭
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  environment: process.env.NODE_ENV,
  dataCollection: { userInfo: false, cookies: false },
  tracesSampleRate: 0.1,
})
