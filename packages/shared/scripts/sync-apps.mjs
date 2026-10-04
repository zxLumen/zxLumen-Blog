// sync:apps —— 把本地「应用栏」配置同步到线上库,一条命令:
//   1) 读本地 dev 库 meta.apps_config(即本地 /admin「应用」面板改的那张表)
//   2) 登录线上,GET 线上现有的应用表
//   3) 按 id 合并:**只补线上没有的**,不动线上已有的(线上可能被 admin 改过)
//   4) POST 整表保存(走站点自己的 /api/admin/apps,由应用写库)
//
// 为什么源是本地 dev 库而不是 content.json:应用栏不在静态内容里,它是纯
// admin 配置(见 apps/next-home/src/lib/app-config.ts)。本地用 /admin 调好、
// 落到本机 zx.db,再由这里推到线上。
//
// 为什么走 HTTP 而不是 SSH + sqlite:线上库文件属容器内 uid 10001,root 直接写会
// 把 db / -wal / -shm 写成 root 所有,之后应用就写不进去了(留言、埋点全挂)。走
// 应用自己的接口,写库的还是应用,权限天然正确。
//
// ⚠️ 应用接口是**整表覆盖且没有乐观锁**(不像 projects 有 rev)。所以脚本在写回前
// 紧挨着重读一次线上表再合并,尽量缩小竞态窗口;真要并发编辑,请错开。
//
// 配置(放 packages/shared/.env.local,已 gitignore;或走环境变量):
//   ZX_SITE            站点地址,默认 https://zxlumen.cn
//   ZX_ADMIN_PASSWORD  线上站长的 admin 密码(必填;库里若改过密码,填改过的那个)
//   DB_PATH            本地 dev 库路径,默认 apps/next-home/data/zx.db
//
// 用法:
//   cd packages/shared
//   npm run sync:apps -- --dry-run            # 只看会加什么,不写
//   npm run sync:apps                          # 把本地缺的都补上
//   npm run sync:apps -- stock                 # 只同步这一个
//   npm run sync:apps -- stock --after yijing  # 插到 yijing 后面
//   npm run sync:apps -- stock --update        # 连线上已有的也按本地覆盖
//   npm run sync:apps -- stock --allow-localhost  # 放行 localhost 地址(默认拒绝)

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { parseArgs } from './lib/sync-projects-core.mjs'
import { mergeApps, isLocalhostUrl } from './lib/sync-apps-core.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')

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

// ---------------------------------------------------------------- 参数
const argv = process.argv.slice(2)
const { dryRun, update, after, onlyIds } = parseArgs(argv)
const allowLocalhost = argv.includes('--allow-localhost')

const SITE = (process.env.ZX_SITE || 'https://zxlumen.cn').replace(/\/+$/, '')
const PASSWORD = process.env.ZX_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || ''
const DB_FILE = process.env.DB_PATH || path.join(repo, 'apps', 'next-home', 'data', 'zx.db')

const log = (...a) => console.log('[sync:apps]', ...a)
const die = (m) => {
  console.error(`[sync:apps] ${m}`)
  process.exit(1)
}

if (!PASSWORD) {
  die('缺少 ZX_ADMIN_PASSWORD。请在 packages/shared/.env.local 写一行:ZX_ADMIN_PASSWORD=…')
}
if (!existsSync(DB_FILE)) die(`找不到本地库 ${DB_FILE}(先在本地 /admin 配好应用,或用 DB_PATH 指定)`)

// ---------------------------------------------------------------- 本地源
const requireApp = createRequire(path.join(repo, 'apps', 'next-home', 'package.json'))
let Database
try {
  Database = requireApp('better-sqlite3')
} catch {
  die('本地缺少 better-sqlite3(先 cd apps/next-home && npm i)')
}

let local
try {
  const db = new Database(DB_FILE, { readonly: true })
  const row = db.prepare("select value from meta where key='apps_config'").get()
  db.close()
  local = row ? JSON.parse(row.value) : []
} catch (e) {
  die(`读本地 apps_config 失败:${e.message}`)
}
if (!Array.isArray(local) || !local.length) die(`本地库 ${DB_FILE} 里没有 apps_config(先在本地 /admin 配应用)`)

const wanted = onlyIds.length ? local.filter((a) => onlyIds.includes(a.id)) : local
if (onlyIds.length) {
  const missing = onlyIds.filter((id) => !local.some((a) => a.id === id))
  if (missing.length) die(`本地 apps_config 里没有这些 id:${missing.join(', ')}`)
}
const localBad = wanted.filter((a) => !allowLocalhost && isLocalhostUrl(a.url))

// ---------------------------------------------------------------- 线上
const login = await fetch(`${SITE}/api/admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
}).catch((e) => die(`连不上 ${SITE}:${e.message}`))

if (!login.ok) die(login.status === 401 ? 'admin 密码不对' : `登录失败 HTTP ${login.status}`)
const setCookie = login.headers.getSetCookie?.() ?? []
const cookie = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('zx_admin='))
if (!cookie) die('登录成功但没拿到会话 cookie')

const api = (method, body) =>
  fetch(`${SITE}/api/admin/apps`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

const got = await api('GET')
if (!got.ok) die(`读取线上应用表失败 HTTP ${got.status}`)
const remote = (await got.json()).apps ?? []
log(`线上 ${remote.length} 个,本地候选 ${wanted.length} 个`)

// ---------------------------------------------------------------- 合并(只加不减)
const { merged, added, changed, skipped, remoteOnly, afterMiss, blocked } = mergeApps(remote, wanted, {
  update,
  after,
  allowLocalhost,
})
if (afterMiss) log(`注意:线上没有 --after 指定的 ${after},改为追加到末尾`)

// ---------------------------------------------------------------- 报告
for (const a of added) log(`  + ${a.id}  ${a.name}  ${a.url}`)
for (const a of changed) log(`  ~ ${a.id}  ${a.name}(覆盖线上)  ${a.url}`)
for (const a of skipped) log(`  = ${a.id}  已在线,跳过(要覆盖加 --update)`)
for (const a of blocked) log(`  ✗ ${a.id}  地址是本机(${a.url}),已跳过;改了再同步,或 --allow-localhost`)
for (const a of remoteOnly) log(`  · ${a.id}  仅线上有,保留`)
if (localBad.length) {
  log(`共 ${localBad.length} 个候选因 localhost 被挡;线上不会写入这些`)
}

if (!added.length && !changed.length) {
  log('没有需要同步的改动')
  process.exit(0)
}
if (dryRun) {
  log(`--dry-run:没有写入。去掉 --dry-run 即执行(${added.length} 新增 / ${changed.length} 覆盖)`)
  process.exit(0)
}

// ---------------------------------------------------------------- 写回
// 整表覆盖无乐观锁 → 写前再读一次,基于最新线上表重算,缩小竞态窗口
const again = await api('GET')
if (again.ok) {
  const latest = (await again.json()).apps ?? []
  if (JSON.stringify(latest) !== JSON.stringify(remote)) {
    log('注意:线上应用表在本地读取后有变动,已基于最新内容重算')
  }
}
const post = await api('POST', { apps: merged })
if (!post.ok) die(`保存失败 HTTP ${post.status}:${(await post.text()).slice(0, 200)}`)

// 复查:重新读一次,确认真的落库了
const after2 = await api('GET')
const final = after2.ok ? (await after2.json()).apps ?? [] : []
log(`完成:线上现在 ${final.length} 个(新增 ${added.length} / 覆盖 ${changed.length})`)
for (const a of added) {
  const ok = final.some((x) => x.id === a.id)
  log(`  ${ok ? '✓' : '✗'} ${a.id}${ok ? '' : '  —— 没落库,请检查'}`)
}
