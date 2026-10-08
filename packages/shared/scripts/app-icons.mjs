/**
 * 生成「应用栏」备选图标(RAG 相关),站长挑选后自己从 /admin → 应用 上传。
 *
 *   node scripts/app-icons.mjs            # 全部重新生成
 *   node scripts/app-icons.mjs doc-search # 只重生成指定名字
 *
 * 成品落到 docker/site-content/apps/cand-<name>.png(256×256),
 * 本地经 /apps/<file> 可直接看(dev 下 public/apps 是指向该目录的软链)。
 * 这些是**候选**,挑完把没选中的 cand-*.png 删掉再上线。
 *
 * 规格对齐已有的 github.png / resume.png(量过):
 *   256×256、圆角 45px、白字形、字形约 110~155px 居中、实色底。
 *
 * 图标本身用 sharp 直接栅格化 SVG(矢量→像素,圆角外是真透明 alpha)。
 * 只有那张「对照表」要排文字,才拉本机 Chrome 整页截一张;
 * 早先试过用 Chrome 的 clip 截图出图标,但页面底色透明时
 * Page.captureScreenshot 的 clip 会整块返回纯白(带 omitBackground 也一样),
 * 圆角外的四角就变成不透明白色,不再是和现有图标一样的规格 —— 所以图标不走浏览器。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../../docker/site-content/apps')
// sharp 只装在 apps/next-home 下(浏览器端压缩也在用),从那儿借一下
const requireApp = createRequire(path.resolve(HERE, '../../../apps/next-home/package.json'))
let sharp
try { sharp = requireApp('sharp') } catch {
  console.error('需要 sharp:cd apps/next-home && npm i sharp(或在根目录 npm i)')
  process.exit(1)
}
// 圆角半径。github.png / resume.png 量下来顶边半透明起点在 x≈45,名义 45。
// 这里用正圆弧 rx=45(而不是去复刻 macOS 那套超椭圆 squircle):两者量出来的
// alpha 剖面有差,但都远小于「哪个图标更上眼」的范围,而超椭圆那套在 librsvg
// 里还会把拐角渲得更小、跟预期对不上 —— 保持一个简单可靠的正圆角。
const R = 45
const SW = 14 // 字形描边

/** 每个候选:底色 + 字形 SVG(内容大致占 110~155px,居中) */
const ICONS = [
  {
    name: 'csdn',
    bg: '#FC5531',
    desc: 'CSDN 官方字标(白字 + 品牌橙底),来源 simple-icons',
    // 官方字标是 24×24 viewBox 的填充路径,先缩放到 150px 再由自动居中校正余量
    glyph: `
      <path transform="translate(33,103) scale(7.9)" fill="#fff" stroke="none"
        d="M4.693 13.638c-.497.568-1.363.63-1.712.63-.648 0-1.144-.164-1.474-.488-.313-.307-.478-.76-.489-1.346-.025-1.358.744-2.762 2.074-2.762.635 0 1.124.455 1.311.644a.337.337 0 0 0 .282.099.38.38 0 0 0 .241-.159c.068-.087.135-.237.138-.401s-.057-.344-.243-.49a2.642 2.642 0 0 0-1.668-.591c-.819 0-1.627.376-2.218 1.033-.621.691-.953 1.63-.935 2.646.015.815.282 1.5.773 1.982.528.518 1.3.791 2.235.791 1.097 0 1.776-.325 2.154-.597a.584.584 0 0 0 .24-.456.702.702 0 0 0-.208-.497c-.23-.248-.448-.101-.503-.037ZM9.663 11.488a7.471 7.471 0 0 0-.698-.248c-.157-.048-.309-.091-.45-.131-.922-.26-1.027-.5-1.017-.68.022-.363.515-.853 1.352-.792.607.045 1.015.509 1.205.781.149.214.371.135.434.095a.602.602 0 0 0 .309-.514.626.626 0 0 0-.209-.488 2.654 2.654 0 0 0-3.347-.273c-.456.323-.744.772-.77 1.202-.064 1.061 1.015 1.366 1.803 1.588.214.061.429.127.667.202 1.14.357 1.173.717 1.092 1.267-.082.556-.696.834-1.685.761-1.029-.076-1.464-.61-1.612-.901-.05-.098-.205-.248-.413-.156-.514.229-.473.731-.26.993.339.416 1.15 1.035 2.667 1.035 1.734 0 2.255-.875 2.378-1.64.092-.572-.022-1.028-.348-1.396-.236-.267-.592-.495-1.101-.706ZM16.44 9.323c-.598-.431-1.393-.61-2.36-.532-.712.058-1.274.243-1.335.263l-.006.002a.437.437 0 0 0-.297.379l-.47 5.201a.337.337 0 0 0 .247.35l.072.02.066.018.086.021a7.914 7.914 0 0 0 1.64.183c.972 0 1.765-.23 2.36-.684.764-.583 1.141-1.5 1.118-2.725-.021-1.135-.398-1.974-1.121-2.495Zm-.662 4.461c-.836.639-2.09.562-2.677.481a.128.128 0 0 1-.109-.137l.397-4.248a.113.113 0 0 1 .086-.1c.999-.241 1.777-.168 2.312.218.189.137.348.331.471.568.176.339.277.765.286 1.234.017.916-.24 1.583-.765 1.984ZM23.967 10.41a1.92 1.92 0 0 0-.432-.919c-.399-.465-1.029-.689-1.848-.689-.734 0-1.372.228-1.947.799.007-.086.019-.159.018-.223s-.017-.116-.066-.163c-.048-.045-.077-.067-.127-.077-.05-.01-.122-.008-.256-.006a.587.587 0 0 0-.589.54s-.325 3.874-.428 5.165a.308.308 0 0 0 .073.228.36.36 0 0 0 .26.131h.387a.224.224 0 0 0 .226-.205l.273-2.929.014-.147a1.902 1.902 0 0 1 .082-.412c.014-.045.03-.092.047-.14.245-.694.803-1.72 1.971-1.694.84.018 1.449.455 1.385 1.114-.101 1.034-.266 3.1-.358 4.14-.019.209.182.273.252.273h.304a.442.442 0 0 0 .444-.404s.185-2.127.294-3.352l.048-.532a1.959 1.959 0 0 0-.026-.5Z"/>`,
  },
  {
    name: 'github',
    bg: '#24292F',
    desc: 'GitHub 猫标(与既有 github.png 同款;重新导出以修正字形偏心)',
    glyph: `
      <path d="M128 44 a84 84 0 0 0 -26.6 163.7 c4.2 .8 5.7 -1.8 5.7 -4 v-15.4 c-23.4 5.1 -28.3 -10 -28.3 -10 -3.8 -9.7 -9.3 -12.3 -9.3 -12.3 -7.6 -5.2 .6 -5.1 .6 -5.1 8.4 .6 12.8 8.6 12.8 8.6 7.5 12.8 19.6 9.1 24.4 7 .8 -5.4 2.9 -9.1 5.3 -11.2 -18.7 -2.1 -38.3 -9.3 -38.3 -41.5 0 -9.2 3.3 -16.7 8.6 -22.6 -.9 -2.1 -3.8 -10.7 .8 -22.3 0 0 7.1 -2.3 23.2 8.6 a80 80 0 0 1 42.3 0 c16.1 -10.9 23.1 -8.6 23.1 -8.6 4.6 11.6 1.7 20.2 .8 22.3 5.4 5.9 8.6 13.4 8.6 22.6 0 32.3 -19.7 39.4 -38.4 41.4 3 2.6 5.7 7.7 5.7 15.6 v23.1 c0 2.2 1.5 4.9 5.7 4 A84 84 0 0 0 128 44 Z" fill="#fff" stroke="none"/>`,
  },
  {
    name: 'resume',
    bg: '#0F766E',
    desc: '简历文档(与既有 resume.png 同款;重新导出以修正字形偏心)',
    glyph: `
      <path d="M86 56 H138 L168 86 V196 a10 10 0 0 1 -10 10 H86 a10 10 0 0 1 -10 -10 V66 a10 10 0 0 1 10 -10 Z" fill="#fff" stroke="none"/>
      <path d="M138 56 L168 86 H146 a8 8 0 0 1 -8 -8 Z" fill="#0F766E" stroke="none"/>
      <path d="M92 112 H142" stroke="#0F766E" stroke-width="11"/>
      <path d="M92 132 H150" stroke="#0F766E" stroke-width="11"/>
      <path d="M92 152 H134" stroke="#0F766E" stroke-width="11"/>
      <path d="M92 172 H144" stroke="#0F766E" stroke-width="11"/>`,
  },
  {
    name: 'doc-search',
    bg: '#0F766E',
    desc: '文档 + 放大镜 —— 检索(Retrieval)最直白的说法',
    // 放大镜在右下,整体重心偏右下,往左上挪一点才对齐画布中心
    tx: -10, ty: 4,
    glyph: `
      <path d="M86 58 H124 L152 86 V152 a12 12 0 0 1 -12 12 H86 a12 12 0 0 1 -12 -12 V70 a12 12 0 0 1 12 -12 Z"/>
      <path d="M124 58 V86 H152" stroke-width="12"/>
      <path d="M96 112 H136" stroke-width="12"/>
      <path d="M96 134 H124" stroke-width="12"/>
      <circle cx="163" cy="150" r="40" fill="BG" stroke="none"/>
      <circle cx="163" cy="150" r="29"/>
      <path d="M184 171 L203 190" stroke-width="15"/>`,
  },
  {
    name: 'db-spark',
    bg: '#4F46E5',
    desc: '数据库 + 星芒 —— 文档入库 / 向量化那一拍',
    // 星芒在右上把重心拽偏了 19px/27px,整体回移居中
    tx: -13, ty: 23,
    glyph: `
      <ellipse cx="114" cy="90" rx="48" ry="16"/>
      <path d="M66 90 V152"/>
      <path d="M162 90 V152"/>
      <path d="M66 152 A48 16 0 0 0 162 152"/>
      <path d="M66 121 A48 16 0 0 0 162 121"/>
      <path d="M200 34 L206 53 L225 60 L206 67 L200 86 L194 67 L175 60 L194 53 Z" fill="#fff" stroke="none"/>`,
  },
  {
    name: 'vector-dots',
    bg: '#7C3AED',
    desc: '向量点阵 / 邻域 —— embedding 与「取回最相近的几条」',
    // 26px 下 0.5 透明的小点几乎看不见,加粗提到不透明
    glyph: `
      <path d="M128 108 V76" stroke-width="12"/>
      <path d="M115 140 L84 158" stroke-width="12"/>
      <path d="M141 140 L172 158" stroke-width="12"/>
      <circle cx="128" cy="128" r="21" fill="#fff" stroke="none"/>
      <circle cx="128" cy="64" r="15" fill="#fff" stroke="none"/>
      <circle cx="76" cy="163" r="15" fill="#fff" stroke="none"/>
      <circle cx="180" cy="163" r="15" fill="#fff" stroke="none"/>
      <circle cx="70" cy="74" r="10" fill="#fff" fill-opacity="0.85" stroke="none"/>
      <circle cx="186" cy="74" r="10" fill="#fff" fill-opacity="0.85" stroke="none"/>
      <circle cx="128" cy="199" r="10" fill="#fff" fill-opacity="0.85" stroke="none"/>`,
  },
  {
    name: 'brain-graph',
    bg: '#E11D48',
    desc: '脑 + 节点网 —— LLM 挂在知识图谱上',
    glyph: `
      <circle cx="128" cy="128" r="64"/>
      <path d="M98 106 H158 V150 H98 Z" stroke-width="10"/>
      <path d="M98 106 L158 150" stroke-width="10"/>
      <circle cx="98" cy="106" r="11" fill="#fff" stroke="none"/>
      <circle cx="158" cy="106" r="11" fill="#fff" stroke="none"/>
      <circle cx="98" cy="150" r="11" fill="#fff" stroke="none"/>
      <circle cx="158" cy="150" r="11" fill="#fff" stroke="none"/>`,
  },
  {
    name: 'chat-doc',
    bg: '#1D4ED8',
    desc: '对话气泡里夹一张文档 —— 检索增强问答(RAG)的成品形态',
    // 尾巴把整体拉得偏下,上提一点;尾巴也收短些,免得字形比 resume 还高
    tx: 0, ty: -2,
    glyph: `
      <path d="M82 58 H174 a24 24 0 0 1 24 24 V138 a24 24 0 0 1 -24 24 H106 L84 202 V186 a24 24 0 0 1 -26 -24 V82 a24 24 0 0 1 24 -24 Z"/>
      <g stroke="BG" stroke-width="12">
        <rect x="100" y="88" width="56" height="50" rx="8" fill="none"/>
        <path d="M114 108 H142" stroke-width="10"/>
        <path d="M114 126 H132" stroke-width="10"/>
      </g>`,
  },
  {
    name: 'books-stack',
    bg: '#B45309',
    desc: '三本书叠起来 —— 知识库 / 语料',
    glyph: `
      <rect x="70" y="78" width="116" height="28" rx="11"/>
      <rect x="84" y="114" width="88" height="28" rx="11"/>
      <rect x="98" y="150" width="60" height="28" rx="11"/>`,
  },
  {
    name: 'hex-node',
    bg: '#047857',
    desc: '六边形 + 中心节点 —— 向量库 / 索引那味',
    glyph: `
      <path d="M128 60 L186 94 L186 162 L128 196 L70 162 L70 94 Z"/>
      <path d="M128 128 V170 M128 128 L99 111 M128 128 L157 111" stroke-width="9"/>
      <circle cx="128" cy="128" r="16" fill="#fff" stroke="none"/>
      <circle cx="128" cy="176" r="9" fill="#fff" stroke="none"/>
      <circle cx="95" cy="107" r="9" fill="#fff" stroke="none"/>
      <circle cx="161" cy="107" r="9" fill="#fff" stroke="none"/>`,
  },
  {
    name: 'funnel',
    bg: '#0369A1',
    desc: '漏斗 —— 从一堆里筛出最相关的几条',
    ty: -6,                                                    // 上沿偏低
    glyph: `
      <path d="M62 70 H194 L146 132 V186 a12 12 0 0 1 -12 12 H122 a12 12 0 0 1 -12 -12 V132 Z"/>
      <circle cx="104" cy="100" r="7" fill="#fff" stroke="none"/>
      <circle cx="128" cy="100" r="7" fill="#fff" stroke="none"/>
      <circle cx="152" cy="100" r="7" fill="#fff" stroke="none"/>`,
  },
]

/**
 * CLI: [name...] 指定只生成哪些;`--scale=N` 字形放大倍数(默认 1,越大越满);
 * `--out=前缀` 改输出文件名前缀(默认 `cand-`);`--no-sheet` 跳过对照表。
 * 例:node scripts/app-icons.mjs doc-search --scale=1.25 --out=cand-s125- --no-sheet
 */
const ARGS = process.argv.slice(2)
const scaleArg = ARGS.find((a) => a.startsWith('--scale='))
const outArg = ARGS.find((a) => a.startsWith('--out='))
const NO_SHEET = ARGS.includes('--no-sheet')
/** 字形整体围绕画布中心放大/缩小(描边随之等比变粗);上限 1.6 免得顶到圆角 */
const SCALE = scaleArg ? Math.max(0.6, Math.min(1.6, parseFloat(scaleArg.slice(8)) || 1)) : 1
const PREFIX = outArg ? outArg.slice(6) : 'cand-'

const svg = (ic, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" rx="${R}" fill="${ic.bg}"/>
<g fill="none" stroke="#fff" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"
   transform="translate(${ic.tx || 0},${ic.ty || 0}) translate(128,128) scale(${SCALE}) translate(-128,-128)${extra}">${ic.glyph.replace(/BG/g, ic.bg)}</g></svg>`

/** 只画字形(透明底),用来量字形的像素包围盒 */
const glyphOnlySvg = (ic) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<g fill="none" stroke="#fff" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"
   transform="translate(${ic.tx || 0},${ic.ty || 0}) translate(128,128) scale(${SCALE}) translate(-128,-128)">${ic.glyph.replace(/BG/g, '#000')}</g></svg>`

/**
 * 量字形的像素包围盒(不看那层圆角底),返回它相对画布中心的偏移。
 * 用它把字形**精确**挪到正中 —— 不靠手算 tx/ty。
 */
async function glyphCenterOffset(ic) {
  const { data, info } = await sharp(Buffer.from(glyphOnlySvg(ic)))
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 20) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { dx: 0, dy: 0 }
  // 包围盒中心相对画布中心的偏差,取反即「挪回正中」所需的平移
  return { dx: 128 - (minX + maxX + 1) / 2, dy: 128 - (minY + maxY + 1) / 2 }
}

/* ---------- 1) 图标本体:sharp 直接把 SVG 栅格化 ---------- */

const only = ARGS.filter((a) => !a.startsWith('--'))
const picked = only.length ? ICONS.filter((i) => only.includes(i.name)) : ICONS
if (!picked.length) { console.error('没有匹配的候选:', only.join(', ')); process.exit(1) }
if (only.length && picked.length !== only.length) {
  console.warn('⚠ 忽略了不存在的名字:', only.filter((n) => !ICONS.some((i) => i.name === n)).join(', '))
}

mkdirSync(OUT, { recursive: true })
for (const ic of picked) {
  const file = path.join(OUT, `${PREFIX}${ic.name}.png`)
  // 先量字形偏了多少,再生成时补上这点平移 → 字形像素级居中
  const { dx, dy } = await glyphCenterOffset(ic)
  await sharp(Buffer.from(svg(ic, ` translate(${dx.toFixed(2)},${dy.toFixed(2)})`)))
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(file)
  const kb = (await import('node:fs')).statSync(file).size / 1024
  const fix = Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15 ? '已居中' : `居中修正 ${dx.toFixed(1)},${dy.toFixed(1)}`
  console.log(`  ✓ ${PREFIX}${ic.name}.png  ${ic.bg}  ${kb.toFixed(1)}KB  ${fix}  ${ic.desc}`)
}

/* ---------- 2) 对照表:要排文字,才拉本机 Chrome 整页截一张 ---------- */

if (NO_SHEET) {
  console.log(`\n共 ${picked.length} 个(--no-sheet,未生成对照表)。目录: ${OUT}`)
  process.exit(0)
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(CHROME)) {
  console.log(`\n共 ${picked.length} 个。对照表需要 Chrome,跳过。`)
  console.log(`目录: ${OUT}`)
  process.exit(0)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pend = new Map()
    ws.onmessage = (e) => { const m = JSON.parse(e.data)
      if (m.id && this.pend.has(m.id)) { const p = this.pend.get(m.id); this.pend.delete(m.id)
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } } }
  static async connect(u) { const ws = new WebSocket(u)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('无法连接 Chrome')) })
    return new Cdp(ws) }
  send(m, p = {}, s) { const id = ++this.seq
    return new Promise((resolve, reject) => { this.pend.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method: m, params: p, ...(s ? { sessionId: s } : {}) })) }) }
}

const PORT = 39711
const profile = mkdtempSync(path.join(tmpdir(), 'zx-ico-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--force-device-scale-factor=1', '--hide-scrollbars',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' })
const bye = () => { try { chrome.kill('SIGKILL') } catch {}; try { rmSync(profile, { recursive: true, force: true }) } catch {} }
process.on('exit', bye)
process.on('SIGINT', () => { bye(); process.exit(1) })

let wsUrl
for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; break } } catch {}
  await sleep(200)
}
if (!wsUrl) { console.log(`\n共 ${picked.length} 个。Chrome 起不来,对照表跳过。`); bye(); process.exit(0) }

const cdp = await Cdp.connect(wsUrl)
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
await cdp.send('Page.enable', {}, sessionId)

const cells = picked.map((ic) =>
  `<figure><div class="box">${svg(ic)}</div><figcaption>${ic.name}</figcaption><p>${ic.desc}</p></figure>`).join('')
// 这张要底色,深色垫一层看着舒服;整页截(不用 clip,透明页面的 clip 会整块返白)
const sheet = `<!doctype html><meta charset="utf-8"><style>
 body{margin:0;padding:24px;background:#0b0d10;color:#e6edf3;
      font:13px/1.5 -apple-system,"Helvetica Neue",Arial,sans-serif}
 h1{font-size:15px;margin:0 0 4px}
 .sub{color:#8b949e;margin:0 0 20px;font-size:12px}
 .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
 figure{margin:0}
 .box{width:128px;height:128px;line-height:0}
 .box svg{width:128px;height:128px}
 figcaption{margin-top:10px;font-weight:600;font-size:12px;color:#fff}
 figure p{margin:2px 0 0;color:#8b949e;font-size:11px;line-height:1.45}
</style><h1>应用栏备选图标 · RAG</h1>
<p class="sub">256×256，圆角 45，白字形；与现有 github.png / resume.png 同规格。挑中后到 /admin → 应用 逐条上传（cand- 前缀的文件用完删掉）。</p>
<div class="grid">${cells}</div>`

await cdp.send('Page.navigate', { url: 'about:blank' }, sessionId)
await cdp.send('Page.setDocumentContent', {
  frameId: (await cdp.send('Page.getFrameTree', {}, sessionId)).frameTree.frame.id, html: sheet,
}, sessionId)
await sleep(800)
const { data: sheetPng } = await cdp.send('Page.captureScreenshot',
  { format: 'png', captureBeyondViewport: true }, sessionId)
writeFileSync(path.join(OUT, 'cand-preview-sheet.png'), Buffer.from(sheetPng, 'base64'))

console.log(`\n共 ${picked.length} 个,另附对照表 cand-preview-sheet.png`)
console.log(`目录: ${OUT}`)
bye()
process.exit(0)
