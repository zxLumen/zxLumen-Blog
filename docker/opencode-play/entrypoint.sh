#!/bin/sh
# 启动入口:每次把「镜像内只读基准配置」重新烤回家目录。
# 家目录挂的是可写卷——opencode 会在 .config 里写 .gitignore 等,故不能整体只读;
# 这里保证:任何运行时对 opencode.json 的篡改,重启即被覆盖回出厂值。
set -e
mkdir -p "$HOME/.config/opencode"
cp /srv/config-ro/opencode.json "$HOME/.config/opencode/opencode.json"
exec opencode "$@"
