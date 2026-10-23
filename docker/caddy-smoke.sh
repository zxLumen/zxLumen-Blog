#!/usr/bin/env bash
# Caddy 子域冒烟:从 caddy/sites/*.caddy 抽出所有 host 逐个 curl。
#
# 为什么需要它:`caddy validate` 只证明"配置语法对",不证明"路由真的在"
# (空 glob、少了一个文件、DNS 没指、证书没签下来,validate 全都照样通过)。
#
# 判定:
#   2xx/3xx/401/403  → ok      (401/403 = basic_auth 生效,路由是通的)
#   502/503/504      → app     (路由通,Caddy 连上了/连不上后端;应用自己的问题)
#   404/000/其它     → route   (路由或 TLS 坏了,这才是要立刻处理的)
#
# 退出码:0 全部 ok;1 有 route 失败;2 只有 app 失败。
# 用法:./caddy-smoke.sh [域名]     (默认取 .env 的 DOMAIN)
set -uo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:-${DOMAIN:-}}"
if [ -z "${DOMAIN}" ] && [ -f .env ]; then
  DOMAIN="$(grep -E '^DOMAIN=' .env | head -n1 | cut -d= -f2- | tr -d '"'"'"' ')"
fi
if [ -z "${DOMAIN}" ]; then
  echo "[smoke] 缺少域名(参数或 .env 里的 DOMAIN)"
  exit 1
fi

# 根域 + 所有子域(子域从 caddy/sites/*.caddy 的站点地址行解析)
HOSTS="$(grep -hoE '^[A-Za-z0-9][A-Za-z0-9._-]*\.\{\$DOMAIN\}' caddy/sites/*.caddy 2>/dev/null \
  | sed 's/\.{\$DOMAIN}$//' | sort -u)"

route_fail=0
app_fail=0
ok=0

check() {
  local host="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${host}/" 2>/dev/null)"
  [ -n "${code}" ] || code="000"
  case "${code}" in
    2*|3*)
      ok=$((ok + 1)); printf '  ok     %-34s %s\n' "${host}" "${code}" ;;
    401|403)
      ok=$((ok + 1)); printf '  ok     %-34s %s (auth)\n' "${host}" "${code}" ;;
    502|503|504)
      app_fail=$((app_fail + 1)); printf '  APP    %-34s %s (路由通,后端没起来)\n' "${host}" "${code}" ;;
    *)
      route_fail=$((route_fail + 1)); printf '  ROUTE  %-34s %s\n' "${host}" "${code}" ;;
  esac
}

echo "[smoke] ${DOMAIN}"
check "${DOMAIN}"
for h in ${HOSTS}; do
  check "${h}.${DOMAIN}"
done

echo "[smoke] ok=${ok} app=${app_fail} route=${route_fail}"
if [ "${route_fail}" -gt 0 ]; then
  exit 1
fi
[ "${app_fail}" -gt 0 ] && exit 2
exit 0
