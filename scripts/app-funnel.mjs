#!/usr/bin/env node
/**
 * 应用卡片转化漏斗:从 events 表聚合每张卡片的曝光 / 点击 / ctr / s3 / r7。
 *
 * 用法:
 *   node scripts/app-funnel.mjs                 # 默认读 apps/next-home/data/zx.db
 *   node scripts/app-funnel.mjs --db /tmp/zx.db
 *   node scripts/app-funnel.mjs --days 7        # 只看最近 7 天的事件(默认全部)
 *
 * 口径:
 *   impression = app_impression 且 dwell=0 的条数(客户端每张卡每次挂载只报一次)
 *   click      = app_click(target=id) + 该应用 bind 指向的合并事件(project/contact/resume)
 *   ctr        = click / impression
 *   s3         = app_impression(dwell≥3,即曝光 3s 后仍可见) / impression
 *   r7         = 点过该 app 的 cid 中,7 天内再次打开(不同会话或间隔 ≥24h)的占比
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const DB_PATH = path.resolve(
  argOf('--db') || process.env.DB_PATH || path.join(ROOT, 'apps/next-home/data/zx.db'),
)
const DAYS = Math.max(0, Number(argOf('--days') || 0) || 0)

if (!fs.existsSync(DB_PATH)) {
  console.error(`找不到数据库:${DB_PATH}`)
  process.exit(1)
}

// better-sqlite3 装在各 app 里(根目录没有);从 next-home 的 package.json 解析
const require = createRequire(path.join(ROOT, 'apps/next-home/package.json'))
const Database = require('better-sqlite3')
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })

/** 老库可能还没补列(没跑过新版本服务端),缺列时按空值处理 */
const cols = new Set(db.prepare('PRAGMA table_info(events)').all().map((c) => c.name))
const hasSession = cols.has('session')
const hasPos = cols.has('pos')

/** 应用配置:lib 里的 DEFAULT_APPS 不落库;没配置过时脚本只知道事件里出现过的 id */
const ADMIN_DEFAULT_BIND = {
  luminari: 'luminari',
  mbti: 'mbti',
  duiwei: 'duiwei',
  voice: 'voice',
  attune: 'attune',
  photo: 'photo',
}
let configured = []
try {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'apps_config'`).get()
  if (row?.value) configured = JSON.parse(row.value)
} catch {
  configured = []
}
/** 未配置过 apps_config 时(新库 / 脚本先于服务端跑)的显示名兜底 */
const DEFAULT_NAMES = {
  github: 'GitHub',
  resume: '简历',
  luminari: '生灵',
  mbti: '心语',
  duiwei: '对位',
  voice: '随口',
  attune: '无恙',
  photo: '光圈',
  game: '酒桌',
  'code-sandbox': '代码沙盒',
}
const apps = new Map()
for (const [id, bind] of Object.entries(ADMIN_DEFAULT_BIND)) {
  apps.set(id, { id, name: DEFAULT_NAMES[id] || id, bind })
}
for (const a of Array.isArray(configured) ? configured : []) {
  if (!a || typeof a.id !== 'string' || a.deleted === true) continue
  apps.set(a.id, { id: a.id, name: a.name || a.id, bind: a.bind || '' })
}

const since = DAYS
  ? new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 19).replace('T', ' ')
  : ''

const sessionExpr = hasSession ? 'session' : "'' AS session"
const posExpr = hasPos ? 'pos' : '-1 AS pos'
const rows = db
  .prepare(
    `SELECT ts, cid, type, target, dwell, ${sessionExpr}, ${posExpr}
       FROM events
      WHERE type IN ('app_impression','app_click','project_click','contact_click','resume_download')
        ${since ? 'AND ts >= ?' : ''}
      ORDER BY ts ASC`,
  )
  .all(...(since ? [since] : []))

const CONTACT_BINDS = new Set(['github', 'wechat', 'email', 'phone', 'guestbook'])
/** 应用点击落在哪种事件上(与 packages/shared/src/ui/app-track.ts 保持一致) */
function clickKey(app) {
  const bind = (app.bind || '').trim()
  if (!bind) return { type: 'app_click', target: app.id }
  if (bind === 'resume') return { type: 'resume_download', target: '' }
  if (CONTACT_BINDS.has(bind)) return { type: 'contact_click', target: bind }
  return { type: 'project_click', target: bind }
}
const clickIndex = new Map()
for (const app of apps.values()) {
  const { type, target } = clickKey(app)
  clickIndex.set(`${type}|${target}`, app.id)
}

const impressions = new Map()
const s3 = new Map()
const clicks = new Map()
const touch = (map, id) => {
  if (!map.has(id)) map.set(id, [])
  return map.get(id)
}

for (const r of rows) {
  if (r.type === 'app_impression') {
    if (!r.target) continue
    if (!apps.has(r.target)) apps.set(r.target, { id: r.target, name: r.target, bind: '' })
    if ((r.dwell || 0) >= 3) {
      s3.set(r.target, (s3.get(r.target) || 0) + 1)
    } else {
      impressions.set(r.target, (impressions.get(r.target) || 0) + 1)
    }
    continue
  }
  const id = clickIndex.get(`${r.type}|${r.target}`)
  if (!id) continue
  if (!apps.has(id)) apps.set(id, { id, name: id, bind: '' })
  touch(clicks, id).push({ cid: r.cid || '', session: r.session || '', ts: r.ts })
}

const pct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '0.0%')
const num = (n) => (n || 0).toLocaleString('en-US')

/** r7:点过该 app 的 cid 中,7 天内「再次打开」的占比 */
function r7(clickRows) {
  const byCid = new Map()
  for (const c of clickRows) {
    if (!c.cid) continue
    if (!byCid.has(c.cid)) byCid.set(c.cid, [])
    byCid.get(c.cid).push(c)
  }
  let total = 0
  let retained = 0
  for (const list of byCid.values()) {
    total += 1
    list.sort((a, b) => a.ts.localeCompare(b.ts))
    const first = Date.parse(`${list[0].ts.replace(' ', 'T')}Z`)
    let again = false
    for (let i = 1; i < list.length; i += 1) {
      const cur = list[i]
      const t = Date.parse(`${cur.ts.replace(' ', 'T')}Z`)
      const gap = t - Date.parse(`${list[i - 1].ts.replace(' ', 'T')}Z`)
      // 新会话 = 真的又打开了一次;老数据没有 session 时退化为「间隔 ≥24h」
      const revisit = (cur.session && cur.session !== list[0].session) || gap >= 86400_000
      if (revisit && t - first <= 7 * 86400_000) {
        again = true
        break
      }
    }
    if (again) retained += 1
  }
  return { retained, total }
}

const out = []
for (const app of apps.values()) {
  const imp = impressions.get(app.id) || 0
  const clickRows = clicks.get(app.id) || []
  const click = clickRows.length
  const s3n = s3.get(app.id) || 0
  const { retained, total } = r7(clickRows)
  out.push({ ...app, imp, click, ctr: imp ? click / imp : 0, s3: imp ? Math.min(1, s3n / imp) : 0, r7: total ? retained / total : 0, retained, total })
}
out.sort((a, b) => b.imp - a.imp || b.click - a.click || a.id.localeCompare(b.id))

console.log(`# 应用卡片转化漏斗`)
console.log('')
console.log(`- 数据库:\`${DB_PATH}\``)
console.log(`- 事件窗口:${DAYS ? `最近 ${DAYS} 天` : '全部'}(共 ${num(rows.length)} 条相关事件)`)
console.log(`- 生成时间:${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`)
console.log('')
console.log('| app | 名称 | impression | click | ctr | s3 | r7 |')
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: |')
if (out.length === 0) {
  console.log('| — | — | 0 | 0 | 0.0% | 0.0% | 0.0% |')
} else {
  for (const a of out) {
    console.log(
      `| ${a.id} | ${a.name} | ${num(a.imp)} | ${num(a.click)} | ${pct(a.click, a.imp)} | ${pct(
        a.s3 * a.imp,
        a.imp,
      )} | ${pct(a.retained, a.total)} |`,
    )
  }
}
console.log('')
console.log('> ctr = click / impression;s3 = 曝光后 3s 仍可见 / impression;r7 = 7 天内同 cid 再次打开 / 打开过的 cid。')
console.log('> impression 只统计 dwell=0 的首报;dwell=3 的心跳计入 s3,不重复计入曝光。')

db.close()
