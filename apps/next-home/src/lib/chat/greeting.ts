// 智能问候(服务端):按 日期/星期/时段/节日/节气/北京天气 用 LLM 生成一组问候语,
// 内存缓存(按 日期+时段+天气 分桶)全站复用;未命中时先返回兜底句并后台异步生成,不阻塞首页。
// 任何失败都逐层降级,绝不抛错。用户的 greetings 作为"语气样本"喂给模型,不直接展示。
import { Solar } from 'lunar-typescript'
import crypto from 'node:crypto'
import { getRuntimeContent } from '@zx/shared/server'
import { getDb } from '../db'
import { chatProtocol, getChatApiKey, getConfig } from './config'
import { completeChat } from './llm'

const BJ_OFFSET = 8 * 3600_000
const LAT = 39.9042
const LON = 116.4074
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const PER_BUCKET = 10

/** 公历趣味日/补充(内置 Solar 节日之外的) */
const EXTRA_SOLAR: Record<string, string> = {
  '01-01': '元旦',
  '02-14': '情人节',
  '03-08': '妇女节',
  '03-12': '植树节',
  '03-14': 'π 日',
  '04-22': '世界地球日',
  '04-23': '世界读书日',
  '05-04': '青年节',
  '06-01': '儿童节',
  '08-01': '建军节',
  '09-10': '教师节',
  '10-24': '程序员节',
  '11-11': '双十一',
  '11-21': '世界问候日',
  '12-24': '平安夜',
  '12-25': '圣诞节',
  '12-31': '跨年夜',
}

const FEST_EMOJI: Record<string, string> = {
  元旦: '🎉',
  春节: '🧧',
  除夕: '🧧',
  元宵节: '🏮',
  端午节: '🥟',
  七夕节: '💫',
  中秋节: '🌕',
  国庆节: '🇨🇳',
  圣诞节: '🎄',
  平安夜: '🎄',
  'π 日': '🥧',
  儿童节: '🧒',
  程序员节: '💻',
  跨年夜: '🎆',
}

const pad = (n: number) => String(n).padStart(2, '0')

interface BjDate {
  y: number
  m: number
  d: number
  h: number
  min: number
  w: number
}

function bj(now: Date): BjDate {
  const t = new Date(now.getTime() + BJ_OFFSET)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes(), w: t.getUTCDay() }
}

/** 4 档时段:早 / 午 / 晚 / 深夜 */
type Bucket = '早' | '午' | '晚' | '深夜'
function bucketOf(h: number): Bucket {
  if (h >= 5 && h < 11) return '早'
  if (h >= 11 && h < 14) return '午'
  if (h >= 14 && h < 22) return '晚'
  return '深夜'
}
function bucketHint(b: Bucket): string {
  switch (b) {
    case '早':
      return '早上的问候,可以自然地说声“早安”'
    case '午':
      return '中午的问候,可以顺口问句吃了没'
    case '晚':
      return '晚上的问候,可以用“晚上好”'
    default:
      return '深夜的问候,可以关心一句“还没睡?”'
  }
}

function festivalOf(y: number, m: number, d: number): string | null {
  const solar = Solar.fromYmdHms(y, m, d, 12, 0, 0)
  const lunar = solar.getLunar()
  const lf = lunar.getFestivals()
  if (lf.length) return lf[0]
  const lof = lunar.getOtherFestivals()
  if (lof.length) return lof[0]
  const sf = solar.getFestivals()
  if (sf.length) return sf[0]
  return EXTRA_SOLAR[`${pad(m)}-${pad(d)}`] ?? null
}

function jieQiOf(y: number, m: number, d: number): string | null {
  return Solar.fromYmdHms(y, m, d, 12, 0, 0).getLunar().getJieQi() || null
}

function normalizeBirthday(s: string): string | null {
  const m = s.trim().match(/(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const mo = Number(m[2])
  const da = Number(m[3])
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  return `${pad(mo)}-${pad(da)}`
}

function wmoText(code: number): string {
  if (code === 0) return '晴'
  if (code <= 2) return '多云'
  if (code === 3) return '阴'
  if (code === 45 || code === 48) return '有雾'
  if (code >= 51 && code <= 57) return '毛毛雨'
  if (code >= 61 && code <= 67) return '小雨'
  if (code >= 71 && code <= 77) return '下雪'
  if (code >= 80 && code <= 82) return '阵雨'
  if (code >= 85 && code <= 86) return '阵雪'
  if (code >= 95) return '雷阵雨'
  return ''
}

let wcache: { at: number; data: { text: string; temp: number; code: number } | null } | null = null

/** 北京实时天气(Open-Meteo,免 key);缓存 40 分钟;失败静默返回 null */
async function beijingWeather(): Promise<{ text: string; temp: number; code: number } | null> {
  const now = Date.now()
  if (wcache && now - wcache.at < 40 * 60_000) return wcache.data
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`
    const res = await fetch(url, { signal: AbortSignal.timeout(3500), cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    const j = (await res.json()) as { current?: { temperature_2m?: number; weather_code?: number } }
    const temp = Math.round(j.current?.temperature_2m ?? NaN)
    const code = j.current?.weather_code ?? -1
    const text = wmoText(code)
    const data = Number.isFinite(temp) && text ? { text, temp, code } : null
    wcache = { at: now, data }
    return data
  } catch {
    wcache = { at: now, data: null }
    return null
  }
}

interface Ctx {
  key: string
  y: number
  m: number
  d: number
  w: number
  bucket: Bucket
  festival: string | null
  jieqi: string | null
  wx: { text: string; temp: number; code: number } | null
  isBirthday: boolean
}

let cache: { key: string; lines: string[] } | null = null
let cacheLoaded = false
let inflightKey: string | null = null

const GREET_META = 'chatbot_greet_cache'

/** 从 DB meta 载入上次生成结果(重启/部署后不再露兜底) */
function loadPersisted(): { key: string; lines: string[] } | null {
  try {
    const raw = getDb().getMeta(GREET_META)
    if (!raw) return null
    const j = JSON.parse(raw) as { key?: unknown; lines?: unknown }
    if (typeof j.key === 'string' && Array.isArray(j.lines)) {
      const lines = j.lines.filter((s): s is string => typeof s === 'string')
      if (lines.length) return { key: j.key, lines }
    }
  } catch {
    /* ignore */
  }
  return null
}

function persist(c: { key: string; lines: string[] }): void {
  try {
    getDb().setMeta(GREET_META, JSON.stringify({ key: c.key, lines: c.lines, at: Date.now() }))
  } catch {
    /* ignore */
  }
}

/** 温度统一为「19°C」形式(℃ 单字形在等宽字体下会走回退、显示怪异) */
function normalizeSymbols(s: string): string {
  return s
    .replace(/\s*℃\s*/g, '°C')
    .replace(/(\d)\s*度/g, '$1°C')
}

/** 解析模型输出为问候句列表 */
function parseLines(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    let s = raw.trim()
    s = s
      .replace(/^[-*•\d]+[.、)）]?\s*/, '')
      .replace(/^["“'‘]+/, '')
      .replace(/["”'’]+$/, '')
      .trim()
    s = normalizeSymbols(s)
    if (s.length < 6 || s.length > 120) continue
    if (/^(问候语|示例|输出|以下|好的|当然)/.test(s)) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= PER_BUCKET) break
  }
  return out
}

async function generate(ctx: Ctx, samples: string[]): Promise<void> {
  if (inflightKey === ctx.key) return
  inflightKey = ctx.key
  try {
    const cfg = getConfig()
    if (!cfg.enabled) return
    const key = getChatApiKey()
    if (!key || !cfg.chatModel || !cfg.chatBaseUrl) {
      console.warn('[greeting] generate skipped: 未就绪', { enabled: cfg.enabled, hasKey: !!key, model: cfg.chatModel, base: !!cfg.chatBaseUrl })
      return
    }

    let who = '站主叫刘子祥,后端 / MLOps 工程师;这是他的个人主页。'
    try {
      const c = await getRuntimeContent()
      if (c.PROFILE) {
        who = `站主叫${c.PROFILE.name}(${c.PROFILE.handle}),${c.PROFILE.title},位于${c.PROFILE.location};这是他的个人主页,回答访客关于他经历/项目/技术的问题。`
      }
    } catch {
      /* ignore */
    }

    const facts = [
      `现在是 ${ctx.y}年${ctx.m}月${ctx.d}日 周${WEEK[ctx.w]},${bucketOf2(ctx.bucket)}。`,
      ctx.festival ? `今天是${ctx.festival}${FEST_EMOJI[ctx.festival] ?? ''}。` : '',
      ctx.jieqi ? `今天是节气「${ctx.jieqi}」。` : '',
      ctx.wx ? `北京实时天气:${ctx.wx.text}、${ctx.wx.temp}°C。` : '',
      ctx.isBirthday ? '今天是站主生日。' : '',
    ]
      .filter(Boolean)
      .join('')

    const prompt = [
      '你在为个人网站写"访客一进来看到的问候语",将由站主的分身说出。',
      `事实:${facts}`,
      `站主:${who}`,
      '要求:',
      '- 中文口语,自然、克制、偶尔一点俏皮;每条 1~2 句,30~70 字。',
      `- ${bucketHint(ctx.bucket)}。`,
      '- 有节日:必须先给一句应景的祝福;有天气:顺带贴合地提一句。',
      '- 结尾自然地带一句轻邀请(例如问问对方想了解站主的什么)。',
      '- 温度一律写成"19°C"这种形式(° 与 C 连写),不要用 ℃ 单字形或"19度"。',
      '- 绝不出现"AI / 模型 / 机器人 / prompt / 助手 / 系统"等词;不要生硬罗列时间地点。',
      '- emoji 极少(0~1 个,多数不带)。',
      '- 不要照抄下面的示例句子,只模仿它们的口吻。',
      '',
      '站主以往的语气示例(仅参考口吻):',
      ...samples.slice(0, 8).map((s, i) => `${i + 1}. ${s}`),
      '',
      `请直接输出 ${PER_BUCKET} 条不同的问候语,每行一条,不要编号、不要引号、不要任何解释。`,
    ].join('\n')

    let lines: string[] = []
    for (let attempt = 0; attempt < 2 && lines.length === 0; attempt++) {
      const text = await completeChat({
        protocol: chatProtocol(),
        baseUrl: cfg.chatBaseUrl,
        apiKey: key,
        model: cfg.chatModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.85,
        maxTokens: 3000,
        provider: cfg.chatProvider,
        // 会话头必须是 ASCII:对含中文的 key 取哈希
        sessionId: `greet:${crypto.createHash('sha1').update(ctx.key).digest('hex').slice(0, 16)}`,
      })
      lines = parseLines(text)
      if (!lines.length) console.warn('[greeting] 解析为空,raw len=', text.length)
    }
    if (lines.length) {
      cache = { key: ctx.key, lines }
      persist(cache)
      console.log(`[greeting] generated ${lines.length} 条 @ ${ctx.key}`)
    } else {
      console.warn('[greeting] 生成失败:两次均为空')
    }
  } catch (e) {
    console.warn('[greeting] generate failed:', e instanceof Error ? e.message : String(e))
  } finally {
    inflightKey = null
  }
}

function bucketOf2(b: Bucket): string {
  return b === '早' ? '早上' : b === '午' ? '中午' : b === '晚' ? '晚上' : '深夜'
}

export interface GreetingOpts {
  /** 是否启用智能问候(否则从 pool 随机) */
  smart?: boolean
  /** 生日/纪念日(YYYY-MM-DD / MM-DD) */
  birthday?: string
  now?: Date
}

/**
 * 返回一条问候语:
 * 命中缓存 → 随机取一条;未命中 → 立即返回兜底句并后台生成(后续请求即用生成版)。
 */
export async function composeGreeting(pool: string[], opts: GreetingOpts = {}): Promise<string> {
  const bases = pool.map((s) => s.trim()).filter(Boolean)
  const pickBase = () => (bases.length ? bases[Math.floor(Math.random() * bases.length)] : '')

  if (opts.smart === false) return pickBase() || '你好,我是刘子祥的分身,想了解他什么都可以问我。'

  const now = opts.now ?? new Date()
  const { y, m, d, w, h } = bj(now)
  const bucket = bucketOf(h)
  const festival = festivalOf(y, m, d)
  const jieqi = jieQiOf(y, m, d)
  const isBirthday = !!opts.birthday && normalizeBirthday(opts.birthday) === `${pad(m)}-${pad(d)}`
  const wx = await beijingWeather()
  // 缓存键只用 北京日期|时段(天气/节日等只在生成时写进文案,避免频繁失效)
  const key = `${y}-${pad(m)}-${pad(d)}|${bucket}`

  const ctx: Ctx = { key, y, m, d, w, bucket, festival, jieqi, wx, isBirthday }

  // 首次使用时载入持久化缓存(重启/部署后不再露兜底)
  if (!cacheLoaded) {
    cache = loadPersisted()
    cacheLoaded = true
  }

  // 命中缓存 → 随机取一条
  if (cache && cache.key === key && cache.lines.length) {
    return cache.lines[Math.floor(Math.random() * cache.lines.length)]
  }

  // 未命中:后台生成(不 await,秒开),本次先回兜底(随机语气样本)
  void generate(ctx, bases)
  return pickBase() || '你好,我是刘子祥的分身,想了解他什么都可以问我。'
}
