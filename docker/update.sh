#!/usr/bin/env bash
# 手动部署/回退入口(替代旧的“git pull + 镜像内构建”流程):
# 新流程由 CI 构建镜像并推 GHCR,服务器只负责 pull。本脚本在服务器上
# 于 ~/zxLumen-Blog/docker 内执行:
#   ./update.sh             # 拉 latest
#   IMAGE_TAG=<sha> ./update.sh   # 回退 / 指定某次提交对应的镜像
set -euo pipefail
cd "$(dirname "$0")"
./deploy.sh "${1:-${IMAGE_TAG:-latest}}"