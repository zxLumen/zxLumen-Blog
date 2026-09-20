#!/usr/bin/env bash
# 在服务器上运行:先 checkpoint 再导出 SQLite,保留最近 14 份
# 用法:./backup.sh   (建议配 cron 每天一次)
set -euo pipefail

cd "$(dirname "$0")"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="./backups"
mkdir -p "$OUT"

echo ">> checkpoint + 导出数据库"
docker compose exec -T app node -e "const D=require('better-sqlite3');const db=new D('/data/zx.db');db.pragma('wal_checkpoint(TRUNCATE)');db.close()"
docker compose cp app:/data/zx.db "$OUT/zx-$STAMP.db"

# 只保留最近 14 份
ls -1t "$OUT"/zx-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f

echo ">> 备份完成:$OUT/zx-$STAMP.db"

# 可选:同步到对象存储(需先配置 rclone remote)
# rclone copy "$OUT/zx-$STAMP.db" remote:zx-backups
