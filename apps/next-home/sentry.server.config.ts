import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  // 未配置 DSN 时完全关闭,不影响其它功能
  enabled: !!dsn,
  // release 在构建期注入(与上传 source map 的 release 一致)
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  environment: process.env.NODE_ENV,
  // 不采集个人/敏感数据(v11 用 dataCollection 取代 sendDefaultPii)
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
    httpHeaders: { request: { deny: ['authorization', 'cookie', 'x-report-token', 'x-metrics-token'] } },
  },
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // 脱敏:去掉 Cookie 与敏感请求头
    if (event.request?.cookies) delete event.request.cookies
    if (event.request?.headers) {
      for (const k of Object.keys(event.request.headers)) {
        if (/^(authorization|cookie|x-report-token|x-metrics-token)$/i.test(k)) delete event.request.headers[k]
      }
    }
    return event
  },
})
