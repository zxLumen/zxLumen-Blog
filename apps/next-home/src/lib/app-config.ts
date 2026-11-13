import type { AppItem, AppOpenIn, StoredApp } from '@zx/shared'
import { normalizeUrl } from '@zx/shared'
import { getDb } from './db'

const META_KEY = 'apps_config'

/**
 * 默认顺序的版本号(整数,每次改顺序 +1)。
 *
 * 访客自己拖过顺序会存 localStorage;站长再调默认顺序时,那份旧存档会让访客
 * 一直看着过期的顺序(「我明明改了,别人还是老的」)。所以给默认顺序配一个版本,
 * 访客存顺序时一起存版本,读到的版本与页面给的不一致 → 丢弃本地顺序、回到新默认。
 * 只存整数、只增不减,回滚也安全(最坏是访客的自定义顺序被重置一次)。
 */
const REV_KEY = 'apps_config_rev'

function readRev(): number {
  try {
    const n = Number(getDb().getMeta(REV_KEY) ?? '0')
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

/** 当前默认顺序版本(未配置过 = 0) */
export function getAppsOrderRev(): number {
  return readRev()
}

/** 默认顺序变了:版本 +1(失败不致命,访客顶多多保留一次旧顺序) */
function bumpRev(): number {
  const next = readRev() + 1
  try {
    getDb().setMeta(REV_KEY, String(next))
  } catch {
    /* 库写失败已经在业务写里暴露,这里不再重复抛 */
  }
  return next
}

/** id 允许的字符:同时用于生成落盘文件名,必须足够严格 */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/i

/** 图标只接受本站 `/apps/` 下的固定形态(兜底 `<id>.<ext>` / 站长上传同名),避免任意 URL 注入 */
const ICON_RE = /^\/apps\/[a-z0-9][a-z0-9-]{0,39}\.(?:jpg|jpeg|png|webp)$/i

/** 卡片首屏截图同样只收本站 `/apps/hooks/` 下的固定形态,避免任意 URL 注入 */
const HOOK_RE = /^\/apps\/hooks\/[a-z0-9][a-z0-9-]{0,39}\.(?:jpg|jpeg|png|webp|gif)$/i

/**
 * 卡片文案默认值:按 id 兜底。
 * 线上 / 本地库多半早已有 `apps_config`(出厂 DEFAULT_APPS 不再生效),
 * 所以在 normalizeOne 里按 id 回填 —— 老数据不用重存也能立刻有文案,
 * 站长以后在库里显式写的值优先。
 * hook 是首屏截图约定路径(资产放 `docker/site-content/apps/hooks/<id>.jpg`)。
 */
const CARD_DEFAULTS: Record<
  string,
  { tagline: string; tags: string[]; action: string; hook?: string }
> = {
  luminari: { tagline: '捏一个会进化的生灵', hook: '/apps/hooks/luminari.jpg', tags: ['养成', '随机', '免登录'], action: '开始创造' },
  mbti: { tagline: '30 秒测出你的 MBTI', hook: '/apps/hooks/mbti.jpg', tags: ['情绪', '对话', '免登录'], action: '测一测' },
  duiwei: { tagline: '挑出最该投的岗位', hook: '/apps/hooks/duiwei.jpg', tags: ['求职', '匹配', '免登录'], action: '开始匹配' },
  attune: { tagline: '说一段话看见状态', hook: '/apps/hooks/attune.jpg', tags: ['情绪', '隐私', '1 分钟'], action: '开始觉察' },
  photo: { tagline: '裁出最好看的构图', hook: '/apps/hooks/photo.jpg', tags: ['修图', '构图', '免登录'], action: '上传照片' },
  voice: { tagline: '对着手机说就行', tags: ['语音', '手机', '免登录'], action: '开始说话' },
  opentodo: { tagline: '待办悬浮在屏幕上', tags: ['待办', '多端', '免登录'], action: '看今天的' },
  stock: { tagline: '今日选股与模拟盘', tags: ['A股', '策略', '模拟盘'], action: '看今日' },
  yijing: { tagline: '起一卦,看看这一卦', tags: ['六十四卦', '免登录'], action: '起卦' },
  game: { tagline: '抽一个酒桌游戏', tags: ['聚会', '免登录'], action: '抽一个' },
  douyu: { tagline: '盯住直播间谁来了', tags: ['直播', '提醒'], action: '看监控' },
  curling: { tagline: '手机上溜一局冰壶', tags: ['小游戏', '1 分钟'], action: '来一局' },
  zuiti: { tagline: '难回的消息交给它', tags: ['微信', '嘴替'], action: '看看' },
  'code-sandbox': { tagline: '浏览器里开个沙盒', tags: ['opencode', '免装'], action: '进入沙盒' },
  resume: { tagline: '下载一页纸简历', tags: ['PDF'], action: '下载' },
  github: { tagline: '35 个公开仓库', tags: ['开源'], action: '去 GitHub' },
}

/** 出厂默认应用(未配置时的初始列表;不落库,保存后才生效) */
const DEFAULT_APPS: AppItem[] = [
  { id: 'github', name: 'GitHub', url: 'https://github.com/zxlumen', bind: 'github' },
  { id: 'resume', name: '简历', url: '/resume.pdf', bind: 'resume' },
  { id: 'luminari', name: '生灵', url: 'luminari.zxlumen.cn', icon: '/apps/luminari.png', openIn: 'panel', bind: 'luminari', ...CARD_DEFAULTS.luminari },
  { id: 'mbti', name: '心语', url: 'https://mbti.zxlumen.cn', icon: '/apps/mbti.png', openIn: 'panel', bind: 'mbti', ...CARD_DEFAULTS.mbti },
  { id: 'duiwei', name: '对位', url: 'https://duiwei.zxlumen.cn', icon: '/apps/duiwei.png', openIn: 'panel', bind: 'duiwei', ...CARD_DEFAULTS.duiwei },
  { id: 'voice', name: '随口', url: 'https://voice.zxlumen.cn', icon: '/apps/voice.png', openIn: 'panel', bind: 'voice' },
  { id: 'attune', name: '无恙', url: 'attune.zxlumen.cn', icon: '/apps/attune.png', openIn: 'panel', bind: 'attune', ...CARD_DEFAULTS.attune },
  { id: 'photo', name: '光圈', url: 'photo.zxlumen.cn', icon: '/apps/photo.png', openIn: 'panel', bind: 'photo', ...CARD_DEFAULTS.photo },
  // 酒桌游戏:独立子域(game.*),主站应用栏 newtab 打开;房间状态在主站 SQLite
  { id: 'game', name: '酒桌', url: 'game.zxlumen.cn', icon: '/apps/game.png', openIn: 'newtab' },
  // 斗鱼监控:宿主机 8899 看板(douyu.*),页内浮层打开;管理员可改、访客只读
  { id: 'douyu', name: '斗鱼监控', url: 'douyu.zxlumen.cn', icon: '/apps/douyu.png', openIn: 'panel', ...CARD_DEFAULTS.douyu },
  // 访客沙盒:公开 opencode web,newtab 打开(见 docs/PLAYGROUND.md);bind 留空 → app_click
  { id: 'code-sandbox', name: '代码沙盒', url: 'code-sandbox.zxlumen.cn', icon: '/apps/code-sandbox.png', openIn: 'newtab' },
]

/** 规范化单条(过滤非法值,兜底字段);无 id 则丢弃 */
function normalizeOne(raw: unknown): StoredApp | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  if (!ID_RE.test(id)) return null
  const url = normalizeUrl(typeof r.url === 'string' ? r.url : '')
  if (!url) return null
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id
  const icon =
    typeof r.icon === 'string' && ICON_RE.test(r.icon.trim()) ? r.icon.trim() : undefined
  // 只认 'self' 与 'panel';留空/未知一律按 newtab 落库,不会把老数据搞坏
  const openIn: AppOpenIn = r.openIn === 'self' || r.openIn === 'panel' ? r.openIn : 'newtab'
  const group = typeof r.group === 'string' && r.group.trim() ? r.group.trim() : undefined
  // 点击埋点绑定(纯统计):空/非字符串一律丢弃,交由前端 resolveAppTrack 兜底成 app_click
  const bind = typeof r.bind === 'string' && r.bind.trim() ? r.bind.trim() : undefined
  // 卡片文案(全部可选;老数据没有这些字段 → 按 id 回填默认文案,再缺就留空由渲染端兜底)
  const card = CARD_DEFAULTS[id]
  const tagline = clip(typeof r.tagline === 'string' ? r.tagline.trim() : '', 14) || card?.tagline
  const hook =
    (typeof r.hook === 'string' && HOOK_RE.test(r.hook.trim()) ? r.hook.trim() : undefined) ?? card?.hook
  const rawTags = Array.isArray(r.tags)
    ? r.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => clip(t.trim(), 12))
        .filter(Boolean)
        .slice(0, 3)
    : []
  const tags = rawTags.length > 0 ? rawTags : card?.tags ?? []
  const action = clip(typeof r.action === 'string' ? r.action.trim() : '', 12) || card?.action
  return {
    id,
    name,
    url,
    ...(icon ? { icon } : {}),
    openIn,
    ...(group ? { group } : {}),
    ...(bind ? { bind } : {}),
    ...(tagline ? { tagline } : {}),
    ...(hook ? { hook } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(action ? { action } : {}),
    deleted: r.deleted === true,
  }
}

/** 按「字」(码点)截断,避免把 emoji / 生僻字切成半个 */
function clip(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max).join('') : s
}

/** 规范化整表(丢弃非法条目) */
export function normalizeAppList(input: unknown): StoredApp[] {
  return Array.isArray(input)
    ? input.map(normalizeOne).filter((a): a is StoredApp => a !== null)
    : []
}

/**
 * 读取完整应用列表(含垃圾箱)。
 * 只在**从未配置过**时回退出厂默认;一旦配置过就以配置为准 ——
 * 包括「配置成一个空数组」(站长想暂时撤掉整个应用栏)。
 */
export function getStoredApps(): StoredApp[] {
  try {
    const raw = getDb().getMeta(META_KEY)
    if (raw === null) return DEFAULT_APPS.map((a) => ({ ...a }))
    return normalizeAppList(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_APPS.map((a) => ({ ...a }))
  }
}

/** 可见项的 id 序列(只看在架的) */
function visibleIds(list: readonly StoredApp[]): string[] {
  return list.filter((a) => !a.deleted).map((a) => a.id)
}

/**
 * 「相对顺序」是否变了:只看两次都在架的那批应用的先后。
 * 纯新增 / 纯删除不算 —— 那种情况访客的自定义顺序仍然有意义(新条目按邻居位置插入),
 * 只有站长真的**调了顺序**,才值得把所有人的自定义顺序重置一遍。
 */
function relativeOrderChanged(prev: readonly StoredApp[], next: readonly StoredApp[]): boolean {
  const nextIds = visibleIds(next)
  const nextPos = new Map(nextIds.map((id, i) => [id, i]))
  const common = visibleIds(prev).filter((id) => nextPos.has(id))
  for (let i = 1; i < common.length; i++) {
    if (nextPos.get(common[i - 1])! > nextPos.get(common[i])!) return true
  }
  return false
}

/** 规范化后写入整表(数组顺序即展示顺序) */
export function saveStoredApps(input: unknown): StoredApp[] {
  const list = normalizeAppList(input)
  const prev = getStoredApps()
  getDb().setMeta(META_KEY, JSON.stringify(list))
  // 只有顺序真的变了才升版本 —— 改名/加一个应用不该把访客的自定义顺序重置
  if (relativeOrderChanged(prev, list)) bumpRev()
  return list
}

/** 恢复为出厂默认(删除配置) */
export function resetStoredApps(): StoredApp[] {
  getDb().delMeta(META_KEY)
  bumpRev()
  return DEFAULT_APPS.map((a) => ({ ...a }))
}

/**
 * 只调整**在架应用**的顺序(垃圾箱条目原地不动),供首页应用栏的站长拖拽用。
 *
 * 为什么单独开一条:应用栏只有「可见项」,若走整表保存,客户端会用这份不完整的
 * 列表覆盖 `meta.apps_config`,垃圾箱里的条目会被顺手删掉。
 *
 * 校验:`ids` 必须与当前可见项集合完全一致 —— 站长在另一个标签页加减过应用时
 * 这里会拒绝(返回 null),由调用方提示刷新,避免用旧列表把新条目冲掉。
 */
export function reorderVisibleApps(ids: readonly string[]): StoredApp[] | null {
  const list = getStoredApps()
  const visible = list.filter((a) => !a.deleted)
  if (ids.length !== visible.length) return null
  const want = new Set(ids)
  if (want.size !== ids.length) return null
  for (const a of visible) if (!want.has(a.id)) return null

  let vi = 0
  const byId = new Map(list.map((a) => [a.id, a]))
  const next = list.map((a) => (a.deleted ? a : (byId.get(ids[vi++]) ?? a)))
  getDb().setMeta(META_KEY, JSON.stringify(next))
  if (relativeOrderChanged(list, next)) bumpRev()
  return next
}

/** 仅取前端要展示的应用(排除垃圾箱),转成展示形状 */
export function getVisibleApps(): AppItem[] {
  return getStoredApps()
    .filter((a) => !a.deleted)
    .map(({ deleted, ...rest }) => {
      void deleted
      return rest
    })
}

/**
 * 就地改某一条的图标字段并整表写回。只动 icon,不碰名称/地址/顺序/删除态 ——
 * 面板上传图标走这里,不经过「整表保存」那条路,避免和编辑中的列表互相覆盖。
 * id 不在配置里返回 null(调用方需提示先保存列表)。
 */
export function patchAppIcon(id: string, icon: string | undefined): StoredApp[] | null {
  const list = getStoredApps()
  if (!list.some((a) => a.id === id)) return null
  const next = list.map((a) => {
    if (a.id !== id) return a
    const merged = { ...a }
    // 字段值为 undefined = 清除该字段(回落到 name 首字)
    if (icon === undefined) delete merged.icon
    else merged.icon = icon
    return merged
  })
  getDb().setMeta(META_KEY, JSON.stringify(next))
  return next
}
