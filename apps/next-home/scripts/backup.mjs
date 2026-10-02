import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// 在容器内运行:用 SQLite 的 online backup API 导出。
// 不再用「checkpoint + copyFileSync」—— 那种做法在 WAL 模式下只要漏掉 -wal
// 就是一份静默残缺的备份,而且和 server.js 同时打开同一个库本身就有风险。
// backup API 走 SQLite 自己的页级复制:不停服务、不依赖 journal_mode、结果一定完整。
const dbPath = process.env.DB_PATH || './data/zx.db'
const outDir = process.env.BACKUP_DIR || './backups'
fs.mkdirSync(outDir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dest = path.join(outDir, `zx-${stamp}.db`)

const db = new Database(dbPath, { readonly: true })
await db.backup(dest)
db.close()

// 只保留最近 14 份
const files = fs
  .readdirSync(outDir)
  .filter((f) => f.startsWith('zx-') && f.endsWith('.db'))
  .sort()
while (files.length > 14) {
  const old = files.shift()
  if (old) fs.unlinkSync(path.join(outDir, old))
}

console.log(`backup -> ${dest}`)