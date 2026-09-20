// 类型、导航等公共部分(可入库)。
// 个人资料(姓名/邮箱/经历等)在 ./content.local.ts(不入库),缺失时用 example 兜底。

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
  period?: string
  demoUrl?: string
  repoUrl?: string
  highlights?: { label: string; value: string }[]
  featured?: boolean
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
  /** 微信号(点击复制/跳转添加) */
  wechat?: string
  /** 电话(倒序存储,避免明文出现在源码/打包产物中;运行时还原) */
  phoneReversed?: string
}

// 个人资料(来自不入库的 content.local.ts)
import * as local from './content.local.js'

export const PROFILE: Profile = local.PROFILE
export const LINKS: LinkItem[] = local.LINKS
export const TECH: TechItem[] = local.TECH
export const TIMELINE: TimelineEntry[] = local.TIMELINE
export const PROJECTS: Project[] = local.PROJECTS
export const SITE_META: SiteMeta = local.SITE_META
export const CONTACTS: Contacts = local.CONTACTS

export const NAV = [
  { label: 'home', href: '/' },
  { label: 'projects', href: '/#projects' },
  { label: 'usage', href: '/#usage' },
  { label: 'about', href: '/#about' },
  { label: 'guestbook', href: '/#guestbook' },
]

const NAV_SECTION_IDS = NAV.filter((n) => n.href.includes('#')).map((n) => n.href.split('#')[1])

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
