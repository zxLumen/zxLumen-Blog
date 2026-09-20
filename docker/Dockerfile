# ---------- 构建 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# 原生模块(better-sqlite3)在缺少预编译包时需要编译工具链
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 先装并编译共享库
COPY packages/shared/package.json packages/shared/package-lock.json* ./packages/shared/
RUN cd packages/shared && npm install
COPY packages/shared ./packages/shared
RUN cd packages/shared && npm run build

# 再装并构建 Next 应用
COPY apps/next-home/package.json apps/next-home/package-lock.json* ./apps/next-home/
RUN cd apps/next-home && npm install
COPY apps/next-home ./apps/next-home
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

COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/next-home ./apps/next-home
RUN mkdir -p /data && chown -R appuser:appuser /app /data

USER appuser
WORKDIR /app/apps/next-home
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
