import type { NextConfig } from "next";
import path from "node:path";

// monorepo:linked dependency (@zx/shared) 在 app 目录之外,
// 需把 turbopack root 指向仓库根,否则 Turbopack 拒绝解析 root 外文件。
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
  },
  // 原生模块不要打包,运行时从 node_modules 加载
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
