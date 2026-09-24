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
};

// Sentry 包装:未配置 DSN / 上传 token 时均为空操作(不影响构建)
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  // 客户端事件经自身域名中转,避免被广告拦截器拦
  tunnelRoute: "/monitoring",
  // 仅当 CI 提供 SENTRY_AUTH_TOKEN 时才上传 source map
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
