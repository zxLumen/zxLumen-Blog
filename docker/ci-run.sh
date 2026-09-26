#!/usr/bin/env bash
# CI 专用入口:由服务器 authorized_keys 的 command= 限制调用,只允许触发部署。
#   ssh 部署密钥执行时,SSH_ORIGINAL_COMMAND = 该次提交的 git sha。
#
# 由于部署密钥被强制绑定到本脚本(scp/sftp 通道会被拦截),且服务器 repo 从不
# `git pull`,这里负责在部署前把「不进镜像」的服务器侧配置从公开仓库同步过来:
#   - docker/Caddyfile
#   - docker/docker-compose.yml
#   - docker/deploy.sh(以及本脚本自身)
#   - docker/observability/(Alloy / Grafana provisioning 与面板)
# 公开仓库 → 匿名 HTTPS 拉取,服务器无需任何 git 凭据。
set -euo pipefail
cd "$(dirname "$0")"

IMAGE_TAG="${SSH_ORIGINAL_COMMAND:-latest}"
REF="${IMAGE_TAG}"

REPO_URL="${REPO_URL:-https://github.com/zxLumen/zxLumen-Blog.git}"

echo "==> CI 触发部署 IMAGE_TAG=${IMAGE_TAG}"

# 同步服务器侧配置(仅这几个文件/目录;用 sparse 拉取避免整仓 clone 到服务器)
if [ "${IMAGE_TAG}" != "latest" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  echo "==> 同步配置:${REPO_URL} @ ${REF}"
  git -C "${TMP}" init -q
  git -C "${TMP}" remote add origin "${REPO_URL}"
  git -C "${TMP}" fetch -q --depth 1 origin "${REF}"
  git -C "${TMP}" checkout -q FETCH_HEAD -- \
    docker/Caddyfile docker/docker-compose.yml docker/deploy.sh docker/ci-run.sh docker/observability
  cp "${TMP}/docker/Caddyfile"          ./Caddyfile
  cp "${TMP}/docker/docker-compose.yml" ./docker-compose.yml
  cp "${TMP}/docker/deploy.sh"          ./deploy.sh          && chmod +x ./deploy.sh
  cp "${TMP}/docker/ci-run.sh"          ./ci-run.sh          && chmod +x ./ci-run.sh
  # 原地同步 observability/:不能 `rm -rf` 整个目录再 `cp -r`(会换掉目录 inode,
  # 让已挂载该目录的 grafana/alloy 容器读到旧路径 → provisioning 报 no such file)。
  # 改为清空内容再复制,保留目录本身。
  mkdir -p ./observability
  find ./observability -mindepth 1 -delete
  cp -r "${TMP}/docker/observability/." ./observability/
  echo "==> 配置已更新"
fi

./deploy.sh "${IMAGE_TAG}"
