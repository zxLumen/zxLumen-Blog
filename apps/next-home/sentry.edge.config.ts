import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NODE_ENV,
  dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
  tracesSampleRate: 0.1,
})
