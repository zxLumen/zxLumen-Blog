// 类型、导航等公共部分(可入库)。
// 个人资料(姓名/邮箱/经历等)不入库:真实数据在 ./content.local.ts,由
// scripts/export-content.mjs 导出为 docker/site-content/content.json(JSON 文件),
// 服务端经 getRuntimeContent() 运行时读取并热更新。
// 编译期/运行时兜底用 ./content.default.ts 的占位默认值。

export interface LinkItem {
  label: string
  url: string
}

export interface TechItem {
  name: string
  /** 0-1 熟练度 */
  level: number
  tags: string[]
}

export interface TimelineEntry {
  period: string
  title: string
  org: string
  desc: string
}

export interface Project {
  id: string
  name: string
  desc: string
  tech: string[]
  status: 'online' | 'demo' | 'building' | 'archived'
  /** 分类:personal=个人新项目(含本站),work=历史工作成果。缺省按本站 demoUrl 推断 */
  kind?: 'personal' | 'work'
  period?: string
  demoUrl?: string
  repoUrl?: string
  highlights?: { label: string; value: string }[]
  featured?: boolean
}

/**
 * 规范化外部链接:裸域名(如 `rag.zxlumen.cn`)补 `https://`,避免被当成相对路径
 * 拼到当前站点(否则会打开 `zxlumen.cn/rag.zxlumen.cn`)。
 * 站内路径(`/`、`#`、`?` 开头)与已带协议(`http(s)://`、`mailto:`、`tel:`)原样返回。
 */
export function normalizeUrl(raw?: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  // 已带协议:http(s)/其它 `scheme://`,或 mailto:/tel: 这类无 `//` 的协议
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(mailto|tel|sms):/i.test(s)) return s
  if (/^[/#?]/.test(s)) return s // 站内路径 / 锚点 / 查询
  return `https://${s}`
}

/** 判断链接是否应新开标签(绝对外链) */
export function isExternalUrl(url?: string): boolean {
  const s = (url ?? '').trim()
  if (/^(mailto|tel|sms):/i.test(s)) return false
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s)
}

export interface Profile {
  name: string
  handle: string
  shell: string
  title: string
  location: string
  email: string
  bioLines: string[]
  statusLine: string
}

export interface SiteMeta {
  title: string
  description: string
  keywords: string[]
}

export interface Contacts {
  email: string
  /** 微信号(点击复制) */
  wechat?: string
  /** 微信二维码图片地址(点击微信时弹出的浮窗展示) */
  wechatQr?: string
  /** 是否配置了电话(号码本身不下发,点击时向 /api/contact/phone 获取) */
  hasPhone?: boolean
  /** 电话(倒序存储,仅服务端 fallback 使用,不下发前端) */
  phoneReversed?: string
}

/** 一份完整站点内容(运行时 content.json 的结构 / 兜底默认值的结构) */
export interface RuntimeContent {
  PROFILE: Profile
  LINKS: LinkItem[]
  TECH: TechItem[]
  TIMELINE: TimelineEntry[]
  PROJECTS: Project[]
  SITE_META: SiteMeta
  CONTACTS: Contacts
}

// 占位默认值(来自 content.local.example.ts,可入库)。
// 站点真实内容由服务端注入:见 server/content-runtime.ts 的 getRuntimeContent()。
import { DEFAULT_CONTENT } from './content.default.js'
export { DEFAULT_CONTENT } from './content.default.js'

export const PROFILE: Profile = DEFAULT_CONTENT.PROFILE
export const LINKS: LinkItem[] = DEFAULT_CONTENT.LINKS
export const TECH: TechItem[] = DEFAULT_CONTENT.TECH
export const TIMELINE: TimelineEntry[] = DEFAULT_CONTENT.TIMELINE
export const PROJECTS: Project[] = DEFAULT_CONTENT.PROJECTS
export const SITE_META: SiteMeta = DEFAULT_CONTENT.SITE_META
export const CONTACTS: Contacts = DEFAULT_CONTENT.CONTACTS

export const NAV = [
  { label: '主页', href: '/' },
  { label: '项目', href: '/#projects' },
  { label: 'Token用量', href: '/#usage' },
  { label: '关于', href: '/#about' },
  { label: '留言板', href: '/#guestbook' },
  { label: '监控', href: 'https://grafana.zxlumen.cn/d/rYdddlPWk/node-exporter-full' },
]

const NAV_SECTION_IDS = NAV.filter((n) => n.href.includes('#')).map((n) => n.href.split('#')[1])

/** 区块 id → 中文名(供访客明细等把 `/#usage` 显示为友好名) */
export const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  NAV.filter((n) => n.href.includes('#')).map((n) => [n.href.split('#')[1], n.label]),
)

/**
 * 首帧前根据 pathname/hash 设置 <html data-nav>,让侧栏选中态即时正确(无 home 闪烁)。
 * 与主题初始化脚本合并输出为一个 <script>。
 */
export const NAV_INIT_SCRIPT = `(function(){try{
var p=location.pathname||'/';var h=(location.hash||'').replace(/^#/,'');
var ids=${JSON.stringify(NAV_SECTION_IDS)};
var v;
if(p==='/'){v=(ids.indexOf(h)>=0)?h:'home';}
else{var seg=p.replace(/^\\//,'').split('/')[0];v=seg||'home';}
document.documentElement.dataset.nav=v;
}catch(e){}})()`
