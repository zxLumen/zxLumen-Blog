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

# 服务器侧配置(Caddyfile / compose)由 CI scp 同步过来;`up -d` 不会因挂载文件
# 内容变化而重启 caddy,这里显式 reload 让它读到新的 Caddyfile(失败不阻断)。
if ${SUDO:-} docker compose ps --status running --services 2>/dev/null | grep -q '^caddy$'; then
  ${SUDO:-} docker compose exec -T -w /etc/caddy caddy caddy reload \
    || echo "[deploy] caddy reload 失败(配置可能未变或语法错误),已跳过"
fi

# 监控配置(observability/alloy.alloy 等)由 ci-run.sh 同步;alloy 以「文件」形式
# bind-mount,配置被覆盖后 inode 变化,旧容器仍读旧文件 → 需重建才能生效。
# grafana 的面板/provisioning 以「目录」挂载,内部文件替换后会被自动读到,但重建一次
# 更省心(容器轻量)。仅当 monitoring profile 正在运行才重建,失败不阻断部署。
if ${SUDO:-} docker compose --profile monitoring ps --status running --services 2>/dev/null | grep -qE '^(alloy|grafana)$'; then
  ${SUDO:-} env IMAGE_TAG="${IMAGE_TAG}" docker compose --profile monitoring up -d --force-recreate alloy grafana \
    || echo "[deploy] 监控容器重建失败,已跳过(可手动 docker compose --profile monitoring up -d --force-recreate alloy grafana)"
fi

# 清理不被任何容器引用的旧镜像(回收 CI 各 tag 镜像;在用镜像不受影响)
${SUDO:-} docker image prune -af

${SUDO:-} docker compose ps
echo "[deploy] 完成"