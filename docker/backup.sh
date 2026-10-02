#!/usr/bin/env bash
# 在服务器上运行:用 SQLite 的 online backup API 在线导出,保留最近 14 份
# 用法:./backup.sh   (建议配 cron 每天一次)
set -euo pipefail

cd "$(dirname "$0")"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="./backups"
mkdir -p "$OUT"

# 用 backup API 而不是 cp:它走 SQLite 自己的页级复制,不停服务、不需要 checkpoint,
# 也不依赖 journal_mode(万一是 WAL 库也不会漏数据)。曾经这里是
# `wal_checkpoint(TRUNCATE)` + `cp` —— 那种做法在 WAL 模式下只要漏了 -wal 就是
# 一份静默残缺的备份。
echo ">> 在线备份数据库(SQLite backup API)"
docker compose exec -T app node -e "
const D = require('better-sqlite3');
const db = new D('/data/zx.db', { readonly: true });
db.backup('/tmp/zx-backup.db')
  .then(() => { db.close(); console.log('backup ok') })
  .catch((e) => { console.error(e); process.exit(1) });
"
docker compose cp app:/tmp/zx-backup.db "$OUT/zx-$STAMP.db"
docker compose exec -T app rm -f /tmp/zx-backup.db

# 只保留最近 14 份
ls -1t "$OUT"/zx-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f

echo ">> 备份完成:$OUT/zx-$STAMP.db"

# 可选:同步到对象存储(需先配置 rclone remote)
# rclone copy "$OUT/zx-$STAMP.db" remote:zx-backups
