import type { StoredVlogSeries, StoredVlogVideo, VlogSeries, VlogStart } from '@zx/shared'
import { getDb } from './db'

const META_KEY = 'vlog_config'

const TITLE_API = 'https://open.douyin.com/api/douyin/v1/video/get_iframe_by_video'
/** 抖音接口对无 UA 的请求可能拒绝,给个普通 UA */
const TITLE_UA = 'Mozilla/5.0 (compatible; zxLumen-Blog/1.0; +https://zxlumen.cn)'
/** 并发上限,避免保存时把接口打爆 */
const TITLE_CONCURRENCY = 4

/**
 * 从用户输入中提取抖音数字视频ID:
 *  - 纯数字:`7554555892894436666`
 *  - 视频链接:`https://www.douyin.com/video/7554555892894436666?...`
 *  - 文案里夹带的链接(取第一段连续数字)
 * 拿不到的短链(`v.douyin.com/xxx`)返回空串(需先展开成 `/video/<id>` 长链)。
 */
export function parseDouyinId(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return ''
  if (/^\d+$/.test(s)) return s
  const m = s.match(/\d{6,}/)
  return m ? m[0] : ''
}

/**
 * 清洗抖音返回的「作品描述」作为展示标题:去掉 #话题 与 @提及,折叠换行/空白并 trim。
 * 清洗后为空则视为无标题(前端回退「第 N 集」)。
 */
export function cleanDouyinDesc(raw: string): string {
  return raw
    .replace(/#[^\s#@]+/g, ' ')
    .replace(/@[^\s#@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 通过视频ID取抖音元信息(官方免登录接口,同一接口同时给「作品描述」与视频宽高)。
 * title 已去话题/提及;w/h 用于自动判断横竖屏。
 * 非公开 / 无效 / 网络失败均返回空值(不抛错,保存流程不受影响)。
 */
export async function fetchDouyinMeta(
  vid: string,
): Promise<{ title: string | null; w?: number; h?: number }> {
  if (!/^\d+$/.test(vid)) return { title: null }
  try {
    const res = await fetch(`${TITLE_API}?video_id=${vid}`, {
      headers: { 'User-Agent': TITLE_UA, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return { title: null }
    const data = (await res.json()) as {
      err_no?: number
      data?: { video_title?: string; video_width?: number; video_height?: number }
    }
    if (data.err_no !== 0) return { title: null }
    const title = data.data?.video_title ? cleanDouyinDesc(String(data.data.video_title)) || null : null
    const w = Number(data.data?.video_width)
    const h = Number(data.data?.video_height)
    return {
      title,
      ...(Number.isFinite(w) && w > 0 ? { w: Math.round(w) } : {}),
      ...(Number.isFinite(h) && h > 0 ? { h: Math.round(h) } : {}),
    }
  } catch {
    return { title: null }
  }
}

/** 规范化单条视频(无有效 vid 则丢弃) */
function normalizeVideo(raw: unknown): StoredVlogVideo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const vid = parseDouyinId(r.vid)
  if (!vid) return null
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  const orientation =
    r.orientation === 'landscape' ? 'landscape' : r.orientation === 'portrait' ? 'portrait' : undefined
  const w = Number(r.w)
  const h = Number(r.h)
  return {
    vid,
    title: title || undefined,
    orientation,
    ...(Number.isFinite(w) && w > 0 ? { w: Math.round(w) } : {}),
    ...(Number.isFinite(h) && h > 0 ? { h: Math.round(h) } : {}),
  }
}

/** 规范化单系列(无 id 或名称则丢弃;保留空系列便于后台新建) */
function normalizeSeries(raw: unknown): StoredVlogSeries | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null
  if (!id) return null
  const videos = Array.isArray(r.videos)
    ? r.videos.map(normalizeVideo).filter((v): v is StoredVlogVideo => v !== null)
    : []
  return {
    id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id,
    videos,
    deleted: r.deleted === true,
  }
}

/** 规范化整表(丢弃非法系列/视频) */
export function normalizeVlogList(input: unknown): StoredVlogSeries[] {
  return Array.isArray(input)
    ? input.map(normalizeSeries).filter((s): s is StoredVlogSeries => s !== null)
    : []
}

/** 写入整表 */
export function writeStoredVlogs(list: StoredVlogSeries[]): StoredVlogSeries[] {
  getDb().setMeta(META_KEY, JSON.stringify(list))
  return list
}

/** 已填标题的条目数 */
export function countTitled(list: StoredVlogSeries[]): number {
  return list.reduce((n, s) => n + s.videos.filter((v) => !!v.title).length, 0)
}

/**
 * 对信息不全的条目(缺标题或宽高)并行调接口补全(限并发),失败保持原样。
 * 不改动已有值,方便手动覆盖。
 */
export async function enrichVlogMeta(series: StoredVlogSeries[]): Promise<StoredVlogSeries[]> {
  const need = new Set<string>()
  for (const s of series) for (const v of s.videos) if (!v.title || !v.w || !v.h) need.add(v.vid)
  if (need.size === 0) return series

  const vids = [...need]
  const meta = new Map<string, { title: string | null; w?: number; h?: number }>()
  let cursor = 0
  const worker = async () => {
    while (cursor < vids.length) {
      const vid = vids[cursor++]
      meta.set(vid, await fetchDouyinMeta(vid))
    }
  }
  await Promise.all(Array.from({ length: Math.min(TITLE_CONCURRENCY, vids.length) }, worker))
  if (meta.size === 0) return series

  return series.map((s) => ({
    ...s,
    videos: s.videos.map((v) => {
      const m = meta.get(v.vid)
      if (!m) return v
      const next = { ...v }
      if (!next.title && m.title) next.title = m.title
      if (!next.w && m.w) next.w = m.w
      if (!next.h && m.h) next.h = m.h
      return next
    }),
  }))
}

/** 读取完整系列列表(含垃圾箱);未配置时为空列表 */
export function getStoredVlogs(): StoredVlogSeries[] {
  try {
    const raw = getDb().getMeta(META_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return normalizeVlogList(parsed)
  } catch {
    return []
  }
}

/** 规范化后写入整表 */
export function saveStoredVlogs(input: unknown): StoredVlogSeries[] {
  return writeStoredVlogs(normalizeVlogList(input))
}

/** 清空配置(恢复为空) */
export function resetStoredVlogs(): StoredVlogSeries[] {
  getDb().delMeta(META_KEY)
  return []
}

/** 仅取首页要展示的系列(排除垃圾箱与空系列),转成展示形状 */
export function getVisibleVlogSeries(): VlogSeries[] {
  return getStoredVlogs()
    .filter((s) => !s.deleted && s.videos.length > 0)
    .map((s) => ({ id: s.id, name: s.name, videos: s.videos }))
}

/** 随机挑一个播放起点(每次进入首页不同);无视频返回 null */
export function pickRandomVlogStart(series: VlogSeries[]): VlogStart | null {
  const pool = series.filter((s) => s.videos.length > 0)
  if (pool.length === 0) return null
  const seriesIndex = Math.floor(Math.random() * pool.length)
  const videoIndex = Math.floor(Math.random() * pool[seriesIndex].videos.length)
  return { series: seriesIndex, video: videoIndex }
}
