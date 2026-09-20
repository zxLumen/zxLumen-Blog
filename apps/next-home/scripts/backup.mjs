import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// 在容器内运行:先 WAL checkpoint 再拷贝,保证备份一致
const dbPath = process.env.DB_PATH || './data/zx.db'
const outDir = process.env.BACKUP_DIR || './backups'
fs.mkdirSync(outDir, { recursive: true })

const db = new Database(dbPath)
db.pragma('wal_checkpoint(TRUNCATE)')
db.close()

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dest = path.join(outDir, `zx-${stamp}.db`)
fs.copyFileSync(dbPath, dest)

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
