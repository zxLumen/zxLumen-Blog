#!/usr/bin/env bash
# 服务器初始化脚本(Ubuntu 22.04 / 24.04,以 root 运行)
# 幂等:可重复执行。会安装 Docker、配置 swap/时区/防火墙/fail2ban,并创建部署用户。
#
# 用法:
#   bash init-server.sh            # 默认部署用户 zx
#   bash init-server.sh myuser     # 自定义用户名
#   SWAP_SIZE_MB=4096 bash init-server.sh
set -euo pipefail

DEPLOY_USER="${1:-zx}"
SWAP_SIZE_MB="${SWAP_SIZE_MB:-2048}"

log() { echo -e "\n==> $*"; }

log "系统更新"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

log "时区 → Asia/Shanghai"
timedatectl set-timezone Asia/Shanghai || true

log "安装基础软件"
apt-get install -y --no-install-recommends \
  curl ca-certificates git ufw fail2ban unattended-upgrades
systemctl enable --now fail2ban || true

log "配置 swap(${SWAP_SIZE_MB} MB)"
if [ ! -f /swapfile ]; then
  if ! fallocate -l "${SWAP_SIZE_MB}M" /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1M count="${SWAP_SIZE_MB}" status=none
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
else
  echo "swap 已存在,跳过"
fi

log "安装 Docker(含 compose 插件)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

log "创建部署用户 ${DEPLOY_USER} 并加入 docker 组"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG sudo,docker "${DEPLOY_USER}"
if [ -f /root/.ssh/authorized_keys ]; then
  mkdir -p "/home/${DEPLOY_USER}/.ssh"
  cp /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
  chmod 700 "/home/${DEPLOY_USER}/.ssh"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
fi

log "防火墙 ufw(放行 SSH + HTTP/HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

log "完成"
docker --version
docker compose version || true
echo
echo "内存/swap:"; free -h
echo
echo "ufw:"; ufw status
echo
echo "⚠ 重要:云控制台的『安全组 / 防火墙』也要放行 22、80、443(轻量应用服务器需在控制台单独放行)。"
echo "⚠ 建议:确认能用密钥登录后,编辑 /etc/ssh/sshd_config 设 PasswordAuthentication no 并重启 sshd。"
