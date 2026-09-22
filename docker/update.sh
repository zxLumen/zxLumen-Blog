#!/usr/bin/env bash
# 应用更新:拉代码 → 重建并重启容器 → 清理旧镜像
# 在服务器上于仓库根(或 docker 目录)执行:./docker/update.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "==> git pull"
git pull --ff-only

echo "==> 重建并启动"
cd docker
docker compose up -d --build

echo "==> 清理悬空镜像"
docker image prune -f

echo "==> 状态"
docker compose ps
