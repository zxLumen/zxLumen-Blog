// cover:push —— 补齐线上「缺失兜底首帧」的横屏视频,一条命令:
//   1) 通过 SSH 读线上库的 vlog_config,拿到权威的横屏 vid 列表
//   2) 列一下服务器上的封面目录,算出缺哪些 <vid>.jpg
//   3) 缺的用本机 Chrome 抓抖音首帧(vlog-cover.mjs --vids;本地已有则跳过生成)
//   4) scp + sudo install 推到服务器封面目录(Caddy /vlog/* 直接静态服务)
//
// 配置(放 packages/shared/.env.local,已 gitignore;或走环境变量):
//   ZX_SSH          ssh 目标,如 ubuntu@1.2.3.4(必填)
//   ZX_SITE         站点地址,默认 https://zxlumen.cn(仅用于最后抽查)
//   ZX_VLOG_DIR     服务器封面目录,默认 ~/zxLumen-Blog/docker/site-content/vlog
//   ZX_DB_VOLUME    服务器库文件路径,默认 /var/lib/docker/volumes/docker_zx-data/_data/zx.db
//
// 用法:
//   cd packages/shared && npm run cover:push
//   npm run cover:push -- --dry-run     # 只看缺哪些

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')
const outDir = path.join(repo, 'docker', 'site-content', 'vlog')

// ---------------------------------------------------------------- 配置
/** 读 packages/shared/.env.local(不存在就跳过);已存在的环境变量优先 */
function loadEnvLocal() {
  const f = path.join(repo, 'packages', 'shared', '.env.local')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const v = m[2].replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
loadEnvLocal()

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const SSH = process.env.ZX_SSH || ''
const SITE = (process.env.ZX_SITE || 'https://zxlumen.cn').replace(/\/+$/, '')
const VLOG_DIR = process.env.ZX_VLOG_DIR || '~/zxLumen-Blog/docker/site-content/vlog'
const DB_VOLUME =
  process.env.ZX_DB_VOLUME || '/var/lib/docker/volumes/docker_zx-data/_data/zx.db'

const log = (...a) => console.log('[cover:push]', ...a)
const die = (m) => {
  console.error(`[cover:push] ${m}`)
  process.exit(1)
}
if (!SSH) {
  die('缺少 ZX_SSH。请在 packages/shared/.env.local 写一行,如:ZX_SSH=ubuntu@1.2.3.4')
}

const ssh = (cmd) => {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', SSH, cmd], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (r.status !== 0) throw new Error((r.stderr || '').trim() || `ssh 退出码 ${r.status}`)
  return r.stdout.trim()
}
const sshTry = (cmd) => {
  try {
    return ssh(cmd)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 读线上配置
log(`SSH ${SSH}`)
// 用服务器自带 python3 只读打开库文件,导出横屏 vid(不依赖密码 / 容器)
const py = [
  'import sqlite3,json',
  `db=sqlite3.connect("file:${DB_VOLUME}?mode=ro",uri=True)`,
  'raw=db.execute("select value from meta where key=?",("vlog_config",)).fetchone()',
  'cfg=json.loads(raw[0])',
  'land=[v["vid"] for s in cfg for v in s.get("videos",[]) if v.get("orientation")=="landscape" or (v.get("orientation")!="portrait" and (v.get("w") or 0)>(v.get("h") or 0))]',
  'print(json.dumps(land))',
].join(';')
let land = []
try {
  land = JSON.parse(ssh(`sudo -n python3 -c '${py}'`))
} catch (e) {
  die(`读取线上配置失败:${e.message}`)
}
if (!Array.isArray(land) || land.length === 0) die('线上没有横屏视频(或 vlog_config 为空)')
log(`线上横屏视频 ${land.length} 条`)

// ---------------------------------------------------------------- 服务器上已有哪些封面
const remoteList = sshTry(`ls -1 ${VLOG_DIR} 2>/dev/null`)
if (remoteList === null) die(`列不出服务器封面目录 ${VLOG_DIR}(检查 ZX_SSH / ZX_VLOG_DIR)`)
const remoteFiles = new Set(remoteList.split('\n').map((s) => s.trim()).filter(Boolean))
const need = land.filter((vid) => !remoteFiles.has(`${vid}.jpg`))

if (need.length === 0) {
  log('✓ 线上兜底首帧都已就位,无需处理')
  process.exit(0)
}
log(`缺兜底首帧 ${need.length} 条:${need.join(', ')}`)
if (dryRun) {
  log('(--dry-run,不动任何东西)')
  process.exit(0)
}

// ---------------------------------------------------------------- 本地生成(本地已有则跳过)
const missingLocal = need.filter((vid) => !existsSync(path.join(outDir, `${vid}.jpg`)))
if (missingLocal.length) {
  log(`本地生成 ${missingLocal.length} 条(需要本机 Chrome,较慢)…`)
  const r = spawnSync(
    process.execPath,
    [path.join(here, 'vlog-cover.mjs'), '--vids', missingLocal.join(',')],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) log('⚠ 生成有失败(本地已有的仍会继续推送)')
} else {
  log('本地已有全部所需图片,跳过生成')
}

// ---------------------------------------------------------------- 推送(scp → sudo install)
const files = need.map((vid) => path.join(outDir, `${vid}.jpg`)).filter((f) => existsSync(f))
const missing = need.filter((vid) => !existsSync(path.join(outDir, `${vid}.jpg`)))
if (files.length === 0) die(`本地一张图都没有,无法推送:${missing.join(', ')}`)

const tmp = `/tmp/zx-covers-${Date.now()}`
log(`推送 ${files.length} 张 → ${VLOG_DIR}`)
const mk = sshTry(`mkdir -p ${tmp}`)
if (mk === null) die('创建远端临时目录失败')

const scp = spawnSync('scp', ['-q', ...files, `${SSH}:${tmp}/`], { encoding: 'utf8', timeout: 120_000 })
if (scp.status !== 0) die(`scp 失败:${(scp.stderr || '').trim()}`)

const install = sshTry(
  `sudo -n install -o 10001 -g 10001 -m 644 ${tmp}/*.jpg ${VLOG_DIR}/ && rm -rf ${tmp}`,
)
if (install === null) die('install 失败(需要服务器上该用户可 sudo,或目录权限不对)')

// ---------------------------------------------------------------- 抽查
log('抽查线上可访问性:')
for (const vid of need.slice(0, 3)) {
  const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '12', `${SITE}/vlog/${vid}.jpg`], {
    encoding: 'utf8',
  })
  log(`  ${SITE}/vlog/${vid}.jpg → ${r.stdout}`)
}

log(`完成:推送 ${files.length} 条${missing.length ? `,失败 ${missing.length} 条(${missing.join(', ')})` : ''}`)
if (missing.length) process.exit(1)
