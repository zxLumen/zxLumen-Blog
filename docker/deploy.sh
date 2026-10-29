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

# 冒烟脚本必须存在:它是唯一能发现"空目录 / 少文件 / 路由没了"的检查,
# 不能因为 ci-run 同步清单漏了就静默跳过。缺失 = 同步有问题,在动任何东西之前中止。
if [ ! -x ./caddy-smoke.sh ]; then
  echo "[deploy] 缺少可执行的 caddy-smoke.sh(ci-run.sh 的同步清单漏了?),已中止"
  exit 1
fi

# 把服务器侧配置(Caddyfile / compose / sites)回滚到最近一次备份。
# 只在「预校验之后仍失败」这种极少数情况下用到,保证磁盘不会留在半套状态。
rollback_config() {
  local bak
  bak="$(cat ./.deploy-backup/LAST 2>/dev/null || true)"
  if [ -z "${bak}" ] || [ ! -d "${bak}" ]; then
    echo "[deploy] 没有可用备份,需人工处理(见 .deploy-backup/)"
    return 1
  fi
  [ -f "${bak}/Caddyfile" ] && cp -a "${bak}/Caddyfile" ./Caddyfile
  [ -f "${bak}/docker-compose.yml" ] && cp -a "${bak}/docker-compose.yml" ./docker-compose.yml
  if [ -d "${bak}/sites" ]; then
    mkdir -p ./caddy/sites
    find ./caddy/sites -mindepth 1 -delete
    cp -a "${bak}/sites/." ./caddy/sites/
  fi
  echo "[deploy] 已回滚服务器侧配置 → ${bak}(容器未改动)"
}

# 先校验 Caddy 配置(ci-run.sh 已把 Caddyfile 与 caddy/sites 同步成仓库版本)。
# 语法/重复站点等问题在**改任何东西之前**就拦下来:线上继续跑旧配置,站点不受影响。
# (以前是 reload 失败 `|| echo` 吞掉 —— 坏配置静默上线比部署失败更糟)
# 用一次性容器(同样的 image / env / 挂载)校验,而不是 exec 进正在跑的 caddy:
# 旧容器可能还没挂上 caddy/sites,exec 校验会「漏看」所有子域文件。
# `compose run` 默认不发布端口,不会和线上 80/443 打架。
if ! ${SUDO:-} env IMAGE_TAG="${IMAGE_TAG}" docker compose run --rm --no-deps -T caddy \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile > /tmp/caddy-validate.log 2>&1; then
  echo "[deploy] Caddy 配置校验失败,已中止部署(线上仍在跑旧配置):"
  grep -vE '"level":"info"' /tmp/caddy-validate.log | tail -n 20
  rollback_config || true
  exit 1
fi
echo "[deploy] Caddy 配置校验通过"

  # sudo 默认 env_reset 会清掉 IMAGE_TAG,用 env 显式传回 compose
  ${SUDO:-} env IMAGE_TAG="${IMAGE_TAG}" docker compose pull app
  # Opentodo 网页版:独立镜像(自己的 CI 推 latest);拉不到不阻断(可能还没上)
  ${SUDO:-} env OPENTODO_TAG="${OPENTODO_TAG:-latest}" docker compose pull opentodo \
    || echo "[deploy] opentodo 镜像拉取失败(可能尚未推送),跳过"
  # 易经六十四卦网页版:同上
  ${SUDO:-} env YIJING_TAG="${YIJING_TAG:-latest}" docker compose pull yijing \
    || echo "[deploy] yijing 镜像拉取失败(可能尚未推送),跳过"
  # StockApp 股票速览:同上
  ${SUDO:-} env STOCK_TAG="${STOCK_TAG:-latest}" docker compose pull stock \
    || echo "[deploy] stock 镜像拉取失败(可能尚未推送),跳过"
  # Luminari 生灵:同上
  ${SUDO:-} env LUMINARI_TAG="${LUMINARI_TAG:-latest}" docker compose pull luminari \
    || echo "[deploy] luminari 镜像拉取失败(可能尚未推送),跳过"
  # 无恙(对话音频觉察):同上
  ${SUDO:-} env ATTUNE_TAG="${ATTUNE_TAG:-latest}" docker compose pull attune \
    || echo "[deploy] attune 镜像拉取失败(可能尚未推送),跳过"
  # 心语(对话式 MBTI 测评):同上
  ${SUDO:-} env MBTI_TAG="${MBTI_TAG:-latest}" docker compose pull mbti \
    || echo "[deploy] mbti 镜像拉取失败(可能尚未推送),跳过"
  # 光圈(AI 构图裁剪 + 自动修图):同上
  ${SUDO:-} env PHOTO_TAG="${PHOTO_TAG:-latest}" docker compose pull photo \
    || echo "[deploy] photo 镜像拉取失败(可能尚未推送),跳过"
  # 酒桌游戏:独立仓库 zxLumen/game 的 CI 推 latest
  ${SUDO:-} env GAME_TAG="${GAME_TAG:-latest}" docker compose pull game \
    || echo "[deploy] game 镜像拉取失败(可能尚未推送),跳过"
  # 冰壶大作战:独立仓库 zxLumen/curling-gates 的 CI 推 latest
  ${SUDO:-} env CURLING_TAG="${CURLING_TAG:-latest}" docker compose pull curling \
    || echo "[deploy] curling 镜像拉取失败(可能尚未推送),跳过"
  ${SUDO:-} env IMAGE_TAG="${IMAGE_TAG}" docker compose up -d

# 服务器侧配置(Caddyfile / caddy/sites / compose)由 ci-run.sh 从仓库同步;
# `up -d` 不会因挂载文件内容变化而重启 caddy,这里显式 reload 让它读到新配置。
# 前面已 validate 过,这里失败就当真失败(不再静默跳过)。
if ${SUDO:-} docker compose ps --status running --services 2>/dev/null | grep -q '^caddy$'; then
  ${SUDO:-} docker compose exec -T -w /etc/caddy caddy caddy reload --config /etc/caddy/Caddyfile
  echo "[deploy] caddy 已 reload"
fi

# 监控配置(observability/alloy.alloy 等)由 ci-run.sh 同步;alloy 以「文件」形式
# bind-mount,配置被覆盖后 inode 变化,旧容器仍读旧文件 → 需重建才能生效。
# grafana 的面板/provisioning 以「目录」挂载,内部文件替换后会被自动读到,但重建一次
# 更省心(容器轻量)。仅当 monitoring profile 正在运行才重建,失败不阻断部署。
if ${SUDO:-} docker compose --profile monitoring ps --status running --services 2>/dev/null | grep -qE '^(alloy|grafana)$'; then
  ${SUDO:-} env IMAGE_TAG="${IMAGE_TAG}" docker compose --profile monitoring up -d --force-recreate alloy grafana \
    || echo "[deploy] 监控容器重建失败,已跳过(可手动 docker compose --profile monitoring up -d --force-recreate alloy grafana)"
fi

# 清理不被任何容器引用的旧镜像(回收 CI 各 tag 镜像;在用镜像不受影响)。
# until=12h:只回收 12 小时前的,避免每次全盘扫描/误删刚推的上一版,略快且更稳。
${SUDO:-} docker image prune -af --filter until=12h

${SUDO:-} docker compose ps

# 部署后冒烟:validate 只证明语法对,不证明每个子域的路由真的还在。
# 存在性已在开头检查过;这里只报告、不阻断 —— 某个子应用自己挂了(502)不该让发布失败,
# 但 404/000 会明确标出来。
./caddy-smoke.sh || echo "[deploy] 冒烟有失败项(见上):ROUTE=路由/TLS 坏了,APP=后端没起来"

echo "[deploy] 完成"