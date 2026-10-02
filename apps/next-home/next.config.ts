import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";

// monorepo:linked dependency (@zx/shared) 在 app 目录之外,
// 需把 turbopack root 指向仓库根,否则 Turbopack 拒绝解析 root 外文件。
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
  },
  // 原生模块不要打包,运行时从 node_modules 加载
  serverExternalPackages: ["better-sqlite3"],
  // 仅产出运行时所需文件(含被 trace 的最小 node_modules),镜像大幅瘦身;见 docker/Dockerfile
  output: "standalone",
  // 注:本地 `next build` 会把 data/zx.db 复制进 .next/standalone —— 它是被
  // instrumentation.js(问候语定时器 → DB 层)trace 进来的,而 outputFileTracingExcludes
  // 按路由匹配、对 instrumentation 这类非路由的 server trace 无效(官方文档明说),
  // 故此处无法排除。镜像本身干净:.dockerignore 的 `**/data` 已把它挡在构建上下文外。
};

// Sentry 包装:未配置 DSN / 上传 token 时均为空操作(不影响构建)
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  // source map 上传的 release 名(与运行时一致,由 CI 注入 git sha)
  release: { name: process.env.SENTRY_RELEASE },
  // 客户端事件经自身域名中转,避免被广告拦截器拦
  tunnelRoute: "/monitoring",
  // 仅当 CI 提供 SENTRY_AUTH_TOKEN 时才上传 source map
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
