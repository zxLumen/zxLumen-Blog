#!/usr/bin/env node
/**
 * 应用栏首屏截图 + 预览清单。
 *
 * 数据源是生产首页 HTML 里的应用栏（等价于生产 `meta.apps_config`，只读，
 * 不连数据库、不写 zx.db）。每个应用用 Playwright 无头 Chromium 在
 * 1280×800 视口截首屏，再在浏览器内转成 WebP：
 *   - 长边 1280（视口本身就是 1280×800，不额外放大）
 *   - 单张 ≤ 120 KB（先降质量，仍超标再缩图）
 * 外站等待 networkidle，最多 8s；超时重试 2 次，最后回退到 domcontentloaded
 * 截「已经渲染出来的首屏」，避免一个慢统计脚本让整张图缺失。
 *
 * 用法：
 *   node scripts/app-shots.mjs
 *   node scripts/app-shots.mjs --source https://zxlumen.cn/ --only github,luminari
 *   node scripts/app-shots.mjs --out /tmp/shots
 *
 * 产物：
 *   docker/site-content/apps/shots/<id>.webp
 *   docker/site-content/apps/shots/manifest.json
 *
 * manifest 结构：
 *   { "generatedAt": "...", "apps": [
 *       { "id", "name", "url", "shot", "intro", "capturedAt" }
 *   ] }
 */

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'

const execFileP = promisify(execFile)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SOURCE = 'https://zxlumen.cn/'
const DEFAULT_OUT = path.join(ROOT, 'docker/site-content/apps/shots')
const VIEWPORT = { width: 1280, height: 800 }
const MAX_EDGE = 1280
const MAX_BYTES = 120 * 1024
const NETWORK_IDLE_MS = 8000
const RETRIES = 2 // 初次 + 2 次重试
const SETTLE_MS = 350

/** 每个应用的一句话介绍（manifest 的 intro；抓图脚本重跑时保持不变） */
const INTROS = {
  github: 'GitHub 开源主页，代码与项目都在这里。',
  csdn: 'CSDN 技术博客，记录工程实践与踩坑。',
  resume: '在线简历，一页看完工作经历与技术栈。',
  brain: 'Agent Brain 智能体知识库与实验场。',
  'code-sandbox': '公开的 OpenCode 代码沙盒，直接在浏览器里跑。',
  opentodo: '轻量待办清单，访客数据各自独立。',
  company: '一人公司经营模拟，体验从 0 到 1。',
  voice: '随口手机语音聊天，开口就能对话。',
  stock: '股票速览，实时行情与自选股。',
  'app-4ib9vf8fp': '易经六十四卦，在线起卦与解读。',
  luminari: '生灵图鉴，观察与培育会发光的小生物。',
  zuiti: '嘴替，帮你把想说的话说得更得体。',
  mbti: '心语对话式 MBTI 测评，聊聊就出结果。',
  attune: '无恙，对话式音频觉察与情绪陪伴。',
  photo: '光圈，AI 构图裁剪与自动修图。',
  'app-tath3kcvk': 'RAG 知识库问答，基于个人语料的检索增强。',
  game: '酒桌小游戏，聚会时打开就能玩。',
  curling: '冰壶大作战，瞄准、蓄力、投壶。',
  duiwei: '对位 JD 智能筛选，快速判断岗位匹配度。',
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const SOURCE = arg('source') || DEFAULT_SOURCE
const OUT = path.resolve(arg('out') || DEFAULT_OUT)
const ONLY = (arg('only') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

/** 从首页 HTML 的 <a class="zx-appdock-item" …> 提取应用栏条目 */
function parseApps(html) {
  const apps = []
  const anchorRe = /<a\b[^>]*class="zx-appdock-item"[^>]*>[\s\S]*?<\/a>/g
  for (const match of html.matchAll(anchorRe)) {
    const tag = match[0]
    const get = (name) => {
      const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
      return m ? decodeEntities(m[1]) : ''
    }
    const id = get('data-app-id')
    if (!id) continue
    const rawHref = get('href')
    let url
    try {
      url = new URL(rawHref, SOURCE).toString()
    } catch {
      url = rawHref
    }
    apps.push({
      id,
      name: get('data-label') || id,
      url,
      /** 生产 HTML 里没有介绍字段；优先用人工维护的一句话 */
      intro: INTROS[id] || `${get('data-label') || id} · 站内应用`,
    })
  }
  return apps
}

/**
 * PDF 不是网页：Chromium 无头里只会触发下载/空白预览。
 * 用 poppler 把第一页渲染成 1280 长边的 PNG（脚本重跑时若系统没有
 * poppler，会回退到浏览器截图，仍能产出可用图）。
 */
async function renderPdfPng(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'zxLumen-app-shots/1.0' } })
  if (!res.ok) throw new Error(`下载 PDF 失败：HTTP ${res.status}`)
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zx-pdf-shot-'))
  const pdf = path.join(dir, 'in.pdf')
  const prefix = path.join(dir, 'page')
  try {
    await writeFile(pdf, Buffer.from(await res.arrayBuffer()))
    try {
      await execFileP('pdftoppm', ['-png', '-f', '1', '-singlefile', '-scale-to', '1280', pdf, prefix])
    } catch {
      await execFileP('pdftocairo', ['-png', '-f', '1', '-singlefile', '-scale-to', '1280', pdf, `${prefix}.png`])
    }
    return await readFile(`${prefix}.png`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 把 PNG data URL 在浏览器里转 WebP。
 * 先保持 1280 长边降质量；仍 >120KB 时再按 0.9 步长缩长边。
 * 返回最终 data URL、实际尺寸、质量与字节数（Node 侧再落盘）。
 */
async function toWebp(page, pngDataUrl) {
  return page.evaluate(
    async ({ src, maxEdge, maxBytes }) => {
      const img = new Image()
      img.src = src
      await img.decode()

      const draw = (scale) => {
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas 2d unavailable')
        ctx.drawImage(img, 0, 0, w, h)
        return { canvas, w, h }
      }

      const initialScale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
      let scale = initialScale
      let dataUrl = ''
      let quality = 0.86
      let width = 0
      let height = 0

      for (let pass = 0; pass < 8; pass++) {
        const { canvas, w, h } = draw(scale)
        width = w
        height = h
        quality = 0.86
        dataUrl = canvas.toDataURL('image/webp', quality)
        while (quality > 0.32) {
          const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)
          if (bytes <= maxBytes) break
          quality = Math.max(0.3, quality - 0.06)
          dataUrl = canvas.toDataURL('image/webp', quality)
        }
        const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)
        if (bytes <= maxBytes) break
        scale *= 0.9
      }

      const bytes = Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)
      return { dataUrl, width, height, quality, bytes, scale }
    },
    { src: pngDataUrl, maxEdge: MAX_EDGE, maxBytes: MAX_BYTES },
  )
}

/** 截一个应用；外站 networkidle 8s，超时重试 2 次，最后 domcontentloaded 兜底 */
async function capture(browser, app, index, total) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()
  const external = new URL(app.url).hostname !== new URL(SOURCE).hostname
  const isPdf = new URL(app.url).pathname.toLowerCase().endsWith('.pdf')
  let lastError = null
  let usedFallback = false
  let png

  try {
    if (isPdf) {
      try {
        png = await renderPdfPng(app.url)
      } catch (err) {
        console.warn(`  ! ${app.id} PDF 渲染失败，回退浏览器截图：${err instanceof Error ? err.message : err}`)
        usedFallback = true
        await page.goto(app.url, { waitUntil: 'load', timeout: 15000 }).catch(() => {})
        png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' })
      }
    } else {
      if (external) {
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
          try {
            await page.goto(app.url, { waitUntil: 'networkidle', timeout: NETWORK_IDLE_MS })
            lastError = null
            break
          } catch (err) {
            lastError = err
            if (attempt < RETRIES) {
              console.warn(`  ↻ ${app.id} networkidle 超时，第 ${attempt + 1} 次重试`)
            }
          }
        }
        if (lastError) {
          console.warn(`  ! ${app.id} networkidle 重试后仍超时，回退 domcontentloaded 截图`)
          usedFallback = true
          await page.goto(app.url, { waitUntil: 'domcontentloaded', timeout: NETWORK_IDLE_MS })
        }
      } else {
        await page.goto(app.url, { waitUntil: 'load', timeout: 15000 })
      }

      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
      await page.waitForTimeout(SETTLE_MS)
      png = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' })
    }

    const pngDataUrl = `data:image/png;base64,${png.toString('base64')}`
    const webp = await toWebp(page, pngDataUrl)
    const b64 = webp.dataUrl.slice(webp.dataUrl.indexOf(',') + 1)
    const buf = Buffer.from(b64, 'base64')
    if (buf.length > MAX_BYTES) {
      throw new Error(`压缩后仍 ${buf.length} bytes（> ${MAX_BYTES}）`)
    }

    const file = path.join(OUT, `${app.id}.webp`)
    await writeFile(file, buf)
    console.log(
      `  ✓ [${index}/${total}] ${app.id} ${webp.width}×${webp.height} ` +
        `q=${webp.quality.toFixed(2)} ${(buf.length / 1024).toFixed(1)}KB` +
        (usedFallback ? ' (fallback)' : ''),
    )
    return {
      id: app.id,
      name: app.name,
      url: app.url,
      shot: `/apps/shots/${app.id}.webp`,
      intro: app.intro,
      capturedAt: new Date().toISOString(),
    }
  } finally {
    await context.close()
  }
}

async function main() {
  console.log(`[app-shots] source=${SOURCE}`)
  const res = await fetch(SOURCE, {
    headers: { 'user-agent': 'zxLumen-app-shots/1.0' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`读取生产首页失败：HTTP ${res.status}`)
  const html = await res.text()
  let apps = parseApps(html)
  if (!apps.length) throw new Error('首页里没找到 .zx-appdock-item（应用栏为空或页面结构变了）')
  if (ONLY.length) apps = apps.filter((a) => ONLY.includes(a.id))
  if (!apps.length) throw new Error(`--only 没有匹配到任何应用：${ONLY.join(', ')}`)

  console.log(`[app-shots] 待抓 ${apps.length} 个应用 → ${OUT}`)
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const items = []
  const failed = []
  try {
    for (let i = 0; i < apps.length; i++) {
      const app = apps[i]
      try {
        items.push(await capture(browser, app, i + 1, apps.length))
      } catch (err) {
        failed.push({ id: app.id, error: err instanceof Error ? err.message : String(err) })
        console.error(`  ✗ [${i + 1}/${apps.length}] ${app.id} 失败：${failed.at(-1).error}`)
      }
    }
  } finally {
    await browser.close()
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    apps: items,
  }
  await writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`[app-shots] 写入 manifest.json：${items.length}/${apps.length} 张`)
  if (failed.length) {
    console.error(`[app-shots] 失败 ${failed.length} 项：${failed.map((f) => f.id).join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(`[app-shots] ${err instanceof Error ? err.message : err}`)
  process.exitCode = 1
})
