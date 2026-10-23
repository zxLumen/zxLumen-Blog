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

SUDO=""
[[ "${EUID}" -eq 0 ]] || SUDO="sudo -n"

# 同步服务器侧配置(仅这几个文件/目录;用 sparse 拉取避免整仓 clone 到服务器)
#
# 落地顺序是「预校验 → 再落地」,保证任何失败都不会在磁盘上留下
# 「新 Caddyfile + 旧/空 sites」这种半套状态 —— 运行中的 caddy 还活着所以当场不挂,
# 但下一次重启/reload 就会让所有子域 404。
if [ "${IMAGE_TAG}" != "latest" ]; then
  TMP="$(mktemp -d)"
  ENV_TMP=""
  trap 'rm -rf "${TMP}"; if [ -n "${ENV_TMP}" ]; then rm -f "${ENV_TMP}"; fi' EXIT
  echo "==> 同步配置:${REPO_URL} @ ${REF}"
  git -C "${TMP}" init -q
  git -C "${TMP}" remote add origin "${REPO_URL}"
  git -C "${TMP}" fetch -q --depth 1 origin "${REF}"
  git -C "${TMP}" checkout -q FETCH_HEAD -- \
    docker/Caddyfile docker/caddy docker/caddy-smoke.sh \
    docker/docker-compose.yml docker/deploy.sh docker/ci-run.sh docker/observability

  # 脚本自身先更新(deploy.sh 末尾要跑 caddy-smoke.sh,漏同步就会静默跳过冒烟)
  cp "${TMP}/docker/deploy.sh"      ./deploy.sh      && chmod +x ./deploy.sh
  cp "${TMP}/docker/ci-run.sh"      ./ci-run.sh      && chmod +x ./ci-run.sh
  cp "${TMP}/docker/caddy-smoke.sh" ./caddy-smoke.sh && chmod +x ./caddy-smoke.sh

  # ---- 源侧校验(空目录 / 坏提交 / checkout 失败都拦住)----
  # 空 glob 在 Caddy 里是合法的,光靠 validate 拦不住"路由全没了"
  SRC_SITES="${TMP}/docker/caddy/sites"
  if [ ! -d "${SRC_SITES}" ]; then
    echo "==> 拒绝同步:仓库里没有 docker/caddy/sites(checkout 失败?)"
    exit 1
  fi
  SITE_COUNT="$(find "${SRC_SITES}" -maxdepth 1 -name '*.caddy' | wc -l)"
  if [ "${SITE_COUNT}" -lt 10 ]; then
    echo "==> 拒绝同步:仓库里只有 ${SITE_COUNT} 个路由文件(<10),疑似坏提交;保持线上不变"
    exit 1
  fi

  # ---- 备份三样(Caddyfile / compose / sites),供这里与 deploy.sh 回滚 ----
  BAK="./.deploy-backup/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "${BAK}" ./.deploy-backup
  cp -a ./Caddyfile "${BAK}/Caddyfile" 2>/dev/null || true
  cp -a ./docker-compose.yml "${BAK}/docker-compose.yml" 2>/dev/null || true
  cp -a ./caddy/sites "${BAK}/sites" 2>/dev/null || true
  echo "${BAK}" > ./.deploy-backup/LAST
  ls -1dt ./.deploy-backup/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
  echo "==> 已备份当前配置 → ${BAK}"

  # ---- 预校验用的环境(必须在动 sites 之前就准备好)----
  # 这一段的任何失败都发生在"还没改线上任何文件"的时刻。
  #
  # ⚠️ 不能直接 `--env-file ./.env`:docker CLI 的 `--env-file` **不剥引号**
  # (compose 的 `env_file:` 会剥)。`.env` 里写成 GRAFANA_BASIC_HASH='$2a$14$…' 时,
  # caddy 拿到带引号的值 → `base64-decoding password: illegal base64 data at input byte 0`,
  # 而线上容器一直是好的(compose 剥了),极难联想到 .env 的书写。
  # 这里生成「只剥成对首尾引号」的临时 env,避开书写习惯;用完 trap 删掉。
  if [ ! -f ./.env ]; then
    echo "==> 缺少 ./.env,无法预校验;已中止"
    exit 1
  fi
  ENV_TMP="$(mktemp)"
  sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)=([\"'])(.*)\2\$/\1=\3/" ./.env > "${ENV_TMP}"
  for v in DOMAIN GRAFANA_BASIC_HASH ZUITI_BASIC_HASH; do
    VVAL="$(grep -E "^${v}=" "${ENV_TMP}" | head -n1 | cut -d= -f2- || true)"
    if [ -z "${VVAL}" ]; then
      echo "==> 预校验环境缺少 ${v}(检查 docker/.env);已中止"
      exit 1
    fi
    case "${VVAL}" in
      \'*|\"*) echo "==> ${v} 仍带引号(剥引号没生效);已中止"; exit 1 ;;
    esac
  done


  # ---- sites:内容级替换 ----
  # ⚠️ 不能 `mv` 换目录:`./caddy/sites` 是目录 bind-mount 挂进 caddy 容器的,
  # 换掉目录 inode 后容器仍指向旧目录;再把旧目录删掉,容器里就变成空目录 →
  # 下一次 reload 所有子域直接消失(observability/ 踩过同一个坑,那里后果小得多)。
  mkdir -p ./caddy/sites
  find ./caddy/sites -mindepth 1 -delete
  cp -r "${SRC_SITES}/." ./caddy/sites/
  echo "==> 子域路由已同步:${SITE_COUNT} 个文件"

  # ---- 预校验:用 staging 的 Caddyfile + 刚同步的 sites ----
  # 通过才落地;不通过就把 sites 原地恢复,线上文件一个字节不动。
  cp "${TMP}/docker/Caddyfile"          ./Caddyfile.staged
  cp "${TMP}/docker/docker-compose.yml" ./docker-compose.yml.staged
  CADDY_IMAGE="$(${SUDO} docker compose config --images 2>/dev/null | grep -m1 '^caddy:' || true)"
  CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.11.7}"
  if ! ${SUDO} docker run --rm --env-file "${ENV_TMP}" \
        -v "$PWD/Caddyfile.staged:/etc/caddy/Caddyfile:ro" \
        -v "$PWD/caddy/sites:/etc/caddy/sites:ro" \
        "${CADDY_IMAGE}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
        > /tmp/caddy-prevalidate.log 2>&1; then
    echo "==> 预校验失败:线上配置未改动,回滚 sites"
    grep -vE '"level":"info"' /tmp/caddy-prevalidate.log | tail -n 20
    find ./caddy/sites -mindepth 1 -delete
    cp -a "${BAK}/sites/." ./caddy/sites/ 2>/dev/null || true
    rm -f ./Caddyfile.staged ./docker-compose.yml.staged
    exit 1
  fi

  # ---- 落地:mv 是 rename(2),原子;cp 覆盖是"截断后写",中间会有半截文件 ----
  mv -f ./Caddyfile.staged ./Caddyfile
  mv -f ./docker-compose.yml.staged ./docker-compose.yml
  echo "==> 配置已更新(预校验通过)"

  # 原地同步 observability/:不能 `rm -rf` 整个目录再 `cp -r`(会换掉目录 inode,
  # 让已挂载该目录的 grafana/alloy 容器读到旧路径 → provisioning 报 no such file)。
  # 改为清空内容再复制,保留目录本身。
  mkdir -p ./observability
  find ./observability -mindepth 1 -delete
  cp -r "${TMP}/docker/observability/." ./observability/
fi

./deploy.sh "${IMAGE_TAG}"
