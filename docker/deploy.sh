#!/usr/bin/env bash
# 部署脚本(在服务器上的 ~/zxLumen-Blog/docker 内运行):
# 从 GHCR 拉取新镜像并滚动更新,然后清理过期镜像。
# 服务器不再构建镜像 → 不再产生构建缓存导致磁盘膨胀。
#
# 用法:
#   IMAGE_TAG=<git-sha> ./deploy.sh      # CI 使用
#   ./deploy.sh                                # 手动:拉 latest
set -euo pipefail
cd "$(dirname "$0")"

IMAGE_TAG="${1:-${IMAGE_TAG:-latest}}"
export IMAGE_TAG

[[ "${EUID}" -eq 0 ]] || SUDO="sudo -n"
echo "[deploy] IMAGE_TAG=${IMAGE_TAG} (工作目录: $(pwd))"

# sudo 默认 env_reset 会清掉 IMAGE_TAG,用 env 显式传回 compose
${SUDO:-} env IMAGE_TAG="${IMAGE_TAG}" docker compose pull app
${SUDO:-} env IMAGE_TAG="${IMAGE_TAG}" docker compose up -d
# 清理不被任何容器引用的旧镜像(回收 CI 各 tag 镜像;在用镜像不受影响)
${SUDO:-} docker image prune -af

${SUDO:-} docker compose ps
echo "[deploy] 完成"