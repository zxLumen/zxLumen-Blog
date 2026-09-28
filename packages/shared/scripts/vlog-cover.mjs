// 抓横屏视频的**兜底封面**:docker/site-content/vlog/<vid>.jpg(抖音视频第 0 帧)。
// 站长自己的封面不在这里管 —— 走 /admin 面板上传,存 <vid>.user.jpg,优先于兜底图。
// 用法:cd packages/shared && npm run cover:vlog
//   --list          只读清单:每条横屏视频当前用哪张封面 / 缺不缺(不联网、不写库)
//   --force         已存在也重抓
//   --only <vid>    只处理指定视频ID(可重复;裸写 vid 也行)
//   --all           连竖屏也一起处理(默认只处理横屏)
//   --db <path>     指定数据库(默认 $DB_PATH 或 apps/next-home/data/zx.db)
//
// 为什么要自备封面:抖音播放器用的封面是 video.cover —— 被裁成 3:4 的竖图,
// 铺在 16:9 的视频区里(object-fit: fill)必然压扁。
//
// ⚠️ 别再把 video.origin_cover 当成「作者上传的封面」:实测它**就是视频第 0 帧**
// (抽帧比对 SSIM 0.98~0.99,8x6 亮度签名逐格一致;cover / cover_original_scale /
// dynamic_cover 是它的 3:4 裁切,gaussian_cover 是同一对象的高斯模糊版,
// big_thumbs 是多帧雪俭图)。也就是说抖音 web 接口里根本没有「用户另设的封面」这个字段,
// 它只能当**兜底**(至少不变形)。真封面请在 /admin 面板上传。
//
// 兜底图的 URL 带签名(x-expires,实测约 14 天过期),所以必须下载到本地,不能长期外链。
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')
const outDir = path.join(repo, 'docker', 'site-content', 'vlog')

const META_KEY = 'vlog_config'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const PORT = 9333
/** 单条视频(含页面加载 + 等 detail 响应)的超时上限 */
const PER_VID_TIMEOUT = 40_000

// ---------------------------------------------------------------- 参数解析
const argv = process.argv.slice(2)
const listOnly = argv.includes('--list')
const force = argv.includes('--force')
const all = argv.includes('--all')
const FLAGS = new Set(['--list', '--force', '--all'])
const VALUE_FLAGS = new Set(['--only', '--db'])
const only = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--only' && argv[i + 1]) only.push(argv[++i])
  else if (VALUE_FLAGS.has(a)) {
    if (!argv[i + 1]) throw new Error(`${a} 后面要跟值`)
    i++
  } else if (/^\d{6,}$/.test(a)) only.push(a) // 裸写 vid 也算
  else if (!FLAGS.has(a)) throw new Error(`不认识的参数 ${a}(可用:--list --force --all --only <vid> --db <路径>)`)
}
const dbArg = argv.indexOf('--db')
const dbPath = dbArg >= 0 && argv[dbArg + 1]
  ? path.resolve(argv[dbArg + 1])
  : process.env.DB_PATH || path.join(repo, 'apps', 'next-home', 'data', 'zx.db')

if (!existsSync(dbPath)) {
  console.error(`[cover:vlog] 找不到数据库 ${dbPath}(可用 --db 指定)`)
  process.exit(1)
}

// ---------------------------------------------------------------- 工具
/**
 * 从图片字节里读宽高。支持 JPEG / PNG / WebP —— 站长自己丢进来的图什么格式都可能有。
 * 返回 { width, height, type } 或 null(不是可识别的图片)。
 */
function imageSize(buf) {
  if (buf.length < 24) return null
  // PNG: 89 50 4E 47 ... IHDR 宽高在 16/20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: 'png' }
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16)
    if (fourcc === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, type: 'webp' }
    }
    if (fourcc === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, type: 'webp' }
    }
    if (fourcc === 'VP8X') {
      const w = buf[24] | (buf[25] << 8) | (buf[26] << 16)
      const h = buf[27] | (buf[28] << 8) | (buf[29] << 16)
      return { width: w + 1, height: h + 1, type: 'webp' }
    }
    return null
  }
  // JPEG: 逐段走,SOF0..SOF15 里排除 DHT(C4) / JPG(C8) / DAC(CC)
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    // 段结构:FF Cx | 长度(2B,含长度本身) | 精度(1B) | 高(2B) | 宽(2B)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), type: 'jpeg' }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 记录「这张封面文件是什么时候被写下的」——用文件自己的 mtime,不用当前时刻。
 * (写成当前时刻会晚于 mtime 几毫秒,导致「站长后来覆盖过」永远识别不出来。)
 */
const fileStamp = (f) => new Date(statSync(f).mtimeMs).toISOString()

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) throw new Error('未找到 Chrome/Chromium')
  return found
}

/** 极简 CDP 客户端(扁平会话,按 sessionId 分流) */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pend = new Map()
    this.listeners = new Set()
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pend.has(m.id)) {
        const { resolve, reject } = this.pend.get(m.id)
        this.pend.delete(m.id)
        if (m.error) reject(new Error(`${m.error.message}(${m.error.code})`))
        else resolve(m.result)
        return
      }
      for (const fn of this.listeners) fn(m)
    }
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('CDP 连接失败'))
    })
    return new Cdp(ws)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pend.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  /** 订阅事件,返回取消订阅函数 */
  on(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  close() {
    this.ws.close()
  }
}

// ---------------------------------------------------------------- 读配置
const db = new Database(dbPath)
const readMeta = db.prepare('SELECT value FROM meta WHERE key = ?')
const writeMeta = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)
const row = readMeta.get(META_KEY)
if (!row) {
  console.error('[cover:vlog] meta.vlog_config 不存在,请先在 admin 里配置视频系列')
  process.exit(1)
}
const list = JSON.parse(String(row.value))
if (!Array.isArray(list)) {
  console.error('[cover:vlog] meta.vlog_config 格式异常')
  process.exit(1)
}

/** 横屏判定,与前端 HeroVlog.isLandscape 保持一致 */
const isLandscape = (v) =>
  v.orientation === 'landscape' ||
  (v.orientation !== 'portrait' && Number(v.w) > 0 && Number(v.h) > 0 && Number(v.w) > Number(v.h))

/** vid → 该 vid 的全部出现位置(同一 vid 可能被放多个系列) */
const targets = []
for (const s of list) {
  for (const v of s.videos ?? []) {
    if (!/^\d{6,}$/.test(String(v.vid ?? ''))) continue
    if (only.length && !only.includes(v.vid)) continue
    if (!all && !isLandscape(v)) continue
    targets.push({ series: s.name || s.id, video: v })
  }
}

if (targets.length === 0) {
  console.log('[cover:vlog] 没有需要处理的横屏视频(用 --all 可连竖屏一起处理)')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })

/** 兜底首帧文件路径(面板上传的 <vid>.user.* 不归这里管) */
const fallbackPath = (vid) => path.join(outDir, `${vid}.jpg`)

/** 终端里 CJK 字符占两列,padEnd 会错位,按显示宽度补空格 */
const dwidth = (s) =>
  [...String(s)].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿가-힯豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1), 0)
const pad = (s, w) => {
  const t = String(s)
  return t + ' '.repeat(Math.max(1, w - dwidth(t)))
}
/** 按显示宽度截断 */
const clip = (s, w) => {
  let out = ''
  let n = 0
  for (const c of String(s)) {
    const cw = dwidth(c)
    if (n + cw > w) return `${out}…`
    out += c
    n += cw
  }
  return out
}

/** 一行现状说明:站长封面 / 兜底首帧 / 缺图 */
const describe = (video) => {
  if (video.coverSrc === 'user') return { state: '你的封面(面板上传)', detail: '—' }
  const f = fallbackPath(video.vid)
  if (!existsSync(f)) return { state: '缺图', detail: '无' }
  const size = imageSize(readFileSync(f))
  return {
    state: '抖音兜底首帧',
    detail: `${size ? `${size.width}x${size.height}` : '未知尺寸'} ${(statSync(f).size / 1024).toFixed(0)}KB`,
  }
}

// ---------------------------------------------------------------- 只读清单
if (listOnly) {
  console.log(`\n[cover:vlog] 横屏视频封面清单(共 ${targets.length} 条)\n`)
  targets.forEach(({ series, video }, i) => {
    const { state, detail } = describe(video)
    console.log(
      `  ${pad(i + 1, 3)}${pad(state, 22)}${pad(clip(series, 14), 16)}${pad(clip(video.title || '（无标题）', 30), 32)}  ${video.vid}  ${detail}`,
    )
  })
  const missing = targets.filter(({ video }) => describe(video).state === '缺图')
  console.log(`\n  缺兜底图的 ${missing.length} 条,补齐:直接跑 npm run cover:vlog(会只补缺的那些)`)
  console.log(`  要换成自己的封面:在 /admin「视频」面板逐条上传,存在 <vid>.user.jpg,优先于兜底图`)
  process.exit(0)
}

// 只管兜底图 <vid>.jpg:面板上传的 <vid>.user.jpg 永远不受影响,两者可以并存
const todo = targets.filter(({ video }) => force || !existsSync(fallbackPath(video.vid)))
if (todo.length === 0) {
  console.log(`[cover:vlog] ${targets.length} 条横屏视频的兜底首帧都已就绪,无需重抓(要重抓加 --force)`)
  process.exit(0)
}

// ---------------------------------------------------------------- 抓取
const profile = mkdtempSync(path.join(tmpdir(), 'zx-vlog-cover-'))
const chromeBin = findChrome()
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const cleanup = () => {
  try {
    chrome.kill()
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}
process.on('exit', cleanup)
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

/** 等浏览器起好调试端口 */
async function waitBrowser() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return (await r.json()).webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome 调试端口未就绪')
}

const wsUrl = await waitBrowser()
const cdp = await Cdp.connect(wsUrl)
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
await cdp.send('Page.enable', {}, sessionId)
await cdp.send('Network.enable', {}, sessionId)

// detail 请求是由 open.douyin.com 这个跨域 iframe(独立进程)发出的,
// 必须自动接管子会话并在它启动前就开好 Network,否则收不到该响应。
cdp.on((m) => {
  if (m.method !== 'Target.attachedToTarget' || m.params.targetInfo.type !== 'iframe') return
  const child = m.params.sessionId
  cdp.send('Network.enable', {}, child).catch(() => {})
  cdp.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {})
})
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId)

const DETAIL_RE = /aweme\/v1\/web\/aweme\/detail/

/** 等该次导航里 detail 请求完整结束,返回 requestId */
function waitDetailRequest() {
  return new Promise((resolve, reject) => {
    let requestId = null
    const timer = setTimeout(() => {
      off()
      reject(new Error('等待 detail 响应超时'))
    }, PER_VID_TIMEOUT)
    const off = cdp.on((m) => {
      if (m.method === 'Network.responseReceived' && DETAIL_RE.test(m.params.response.url)) {
        requestId = m.params.requestId
        return
      }
      if (m.method === 'Network.loadingFinished' && requestId && m.params.requestId === requestId) {
        clearTimeout(timer)
        off()
        resolve(requestId)
      }
    })
  })
}

/** 打开播放器页,等 detail 响应,返回该作品的元信息 */
async function fetchAweme(vid) {
  const pending = waitDetailRequest()
  await cdp.send('Page.navigate', { url: `https://open.douyin.com/player/video?vid=${vid}&autoplay=0` }, sessionId)
  const requestId = await pending
  const { body } = await cdp.send('Network.getResponseBody', { requestId }, sessionId)
  const data = JSON.parse(body)
  const aweme = data.aweme_detail ?? data.aweme_list?.[0]
  if (!aweme?.video) throw new Error('detail 响应里没有作品数据')
  return aweme
}

const done = new Set()
let ok = 0
let skipped = 0
const failed = []

for (const [idx, { series, video }] of todo.entries()) {
  const vid = video.vid
  const file = path.join(outDir, `${vid}.jpg`)
  const label = `[${idx + 1}/${todo.length}] ${series}/${vid}`
  try {
    if (done.has(vid)) {
      skipped++
    } else {
      const aweme = await fetchAweme(vid)
      // 注意:origin_cover 实测 = 视频第 0 帧(不是站长上传的封面),只作兜底
      const urls = (aweme.video.origin_cover?.url_list ?? []).filter(Boolean)
      if (urls.length === 0) throw new Error('没有 origin_cover(该作品可能不是常规视频)')

      let saved = null
      let lastErr = null
      for (const u of urls.slice(0, 3)) {
        const res = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/' } })
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`)
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length < 2048) {
          lastErr = new Error(`响应过小(${buf.length}B)`)
          continue
        }
        const size = imageSize(buf)
        if (!size) {
          lastErr = new Error('不是可识别的图片')
          continue
        }
        if (size.width <= size.height) {
          // 不判失败:前端 object-fit: contain 会等比缩放并补黑边,画面一点不裁
          console.log(`  · ${label} 兜底图不是横图(${size.width}x${size.height}),前台会补黑边`)
        }
        writeFileSync(file, buf)
        saved = { size, bytes: buf.length }
        break
      }
      if (!saved) throw lastErr ?? new Error('下载失败')
      video.cover = `/vlog/${vid}.jpg`
      video.coverSrc = 'douyin'
      video.coverAt = fileStamp(file)
      done.add(vid)
      ok++
      console.log(
        `${label} ✓ 兜底首帧 ${saved.size.width}x${saved.size.height} ${(saved.bytes / 1024).toFixed(0)}KB ` +
          `·源 ${aweme.video.width}x${aweme.video.height}`,
      )
    }
  } catch (e) {
    failed.push(`${vid}: ${e.message}`)
    console.error(`${label} ✗ ${e.message}`)
  }
}

if (ok > 0) {
  writeMeta.run(META_KEY, JSON.stringify(list))
  console.log('[cover:vlog] 提示:上面这些只是抖音兜底首帧图(视频第 0 帧),不是你上传的封面')
  console.log('[cover:vlog] 换成你自己的封面:在 /admin「视频」面板逐条上传,存 <vid>.user.jpg,优先于兜底图')
}
cdp.close()
cleanup()

console.log(
  `\n[cover:vlog] 完成 ${ok} 条,跳过 ${skipped} 条,失败 ${failed.length} 条 → ${path.relative(repo, outDir)}`,
)
if (failed.length) {
  console.error(`  失败:${failed.join('; ')}`)
  process.exitCode = 1
}
if (ok > 0) {
  console.log('[cover:vlog] 记得把 docker/site-content/vlog/ 一并 scp 到服务器(Caddy 直接静态服务 /vlog/*)')
}
process.exit(process.exitCode ?? 0)
