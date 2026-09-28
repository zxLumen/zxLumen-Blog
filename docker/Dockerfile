# ---------- 构建 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# 原生模块(better-sqlite3)在缺少预编译包时需要编译工具链
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 先装并编译共享库(cache mount 复用 npm 下载缓存,lockfile 不变时更快)
COPY packages/shared/package.json packages/shared/package-lock.json* ./packages/shared/
RUN --mount=type=cache,target=/root/.npm cd packages/shared && npm install
COPY packages/shared ./packages/shared
RUN cd packages/shared && npm run build

# 再装并构建 Next 应用
COPY apps/next-home/package.json apps/next-home/package-lock.json* ./apps/next-home/
RUN --mount=type=cache,target=/root/.npm cd apps/next-home && npm install
COPY apps/next-home ./apps/next-home

# Sentry:DSN 为公开值,构建期注入以启用前端上报;AUTH_TOKEN 仅用于上传 source map(缺省则跳过)
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_RELEASE=""
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG SENTRY_RELEASE=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_RELEASE=$SENTRY_RELEASE

RUN cd apps/next-home && npm run build

# ---------- 运行 ----------
FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_PATH=/data/zx.db

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 10001 appuser

# standalone 产物:只含 server.js + 被 trace 的最小 node_modules(镜像从 ~1GB 降到 ~120MB)。
# monorepo 布局:turbopack root = 仓库根,故 standalone 根镜像出 apps/ 与 packages/ 两级,
# server.js 在 apps/next-home/ 下;@zx/shared 与 better-sqlite3 原生绑定均已 trace 进去。
COPY --chown=appuser:appuser --from=build /app/apps/next-home/.next/standalone ./
COPY --chown=appuser:appuser --from=build /app/apps/next-home/.next/static ./apps/next-home/.next/static
COPY --chown=appuser:appuser --from=build /app/apps/next-home/public ./apps/next-home/public
RUN mkdir -p /data && chown appuser:appuser /data

USER appuser
WORKDIR /app/apps/next-home
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
