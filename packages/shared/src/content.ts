export interface LinkItem {
  label: string
  url: string
}

export interface TechItem {
  name: string
  /** 0-1 熟练度,供进度条/可视使用 */
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
  /** 一句话简介 */
  desc: string
  /** 技术栈 badge */
  tech: string[]
  /** 状态:online 可访问 / demo 演示中 / building 建设中 / archived 归档 */
  status: 'online' | 'demo' | 'building' | 'archived'
  /** 部署在你自己服务器上的子域名,如 demo1.yourdomain.com(无域名时留空) */
  demoUrl?: string
  repoUrl?: string
  /** 亮点数字/指标 */
  highlights?: { label: string; value: string }[]
  featured?: boolean
}

// ===========================================================================
// ⚠️ 下面全是你的真实资料占位,next 里程碑会替换成你的内容
// ===========================================================================

export const PROFILE = {
  name: '刘子祥',
  handle: 'liuzixiang',
  shell: 'lz@zx.dev',
  title: '全栈工程师 · 独立开发者',
  location: '中国 · 上海',
  email: 'you@example.com',
  bioLines: [
    '一只热衷于全栈开发与 AI 应用折腾的工程♂徒。',
    '信仰:写好代码,睡好觉,把想法做成能摸的产品。',
    '主力语言 TypeScript,容器与自托管重度用户。',
  ],
  statusLine: '开源 · 自部署 · AI×接口',
}

export const LINKS: LinkItem[] = [
  { label: 'github', url: 'https://github.com/liuzixiang' },
  { label: 'email', url: 'mailto:you@example.com' },
  { label: 'blog', url: '' },
  { label: 'resume', url: '/about' },
]

export const TECH: TechItem[] = [
  { name: 'TypeScript', level: 0.9, tags: ['node', 'browser', 'types'] },
  { name: 'React / Next.js', level: 0.85, tags: ['ui', 'ssr', 'fullstack'] },
  { name: 'Vue / Nuxt', level: 0.7, tags: ['ui', 'ssr'] },
  { name: 'Node.js / Bun', level: 0.85, tags: ['backend', 'api'] },
  { name: 'SQLite / Postgres', level: 0.8, tags: ['db', 'sql'] },
  { name: 'Docker / 自托管', level: 0.85, tags: ['vps', 'compose', 'nginx'] },
  { name: 'DeepSeek / LLM API', level: 0.8, tags: ['ai', 'prompt', 'cost'] },
]

export const TIMELINE: TimelineEntry[] = [
  {
    period: '2023 — now',
    title: '全栈开发 / 独立项目',
    org: '自由职业 & 自建服务',
    desc: '开发并自托管多个线上服务,涉猎 AI 应用、工具站与自动化脚本。',
  },
  {
    period: '20xx — 20xx',
    title: '职位名',
    org: '公司名',
    desc: 'TODO: 补一段简短的工作/项目经历。',
  },
  {
    period: '20xx — 20xx',
    title: '学历',
    org: '学校',
    desc: 'TODO: 补充教育经历。',
  },
]

export const PROJECTS: Project[] = [
  {
    id: 'zx-home',
    name: 'zx.dev — 本页',
    desc: '你现在看的这个人主页:Next.js / TanStack 双战场,SQLite 留言 + DeepSeek 用量面板,自托管部署。',
    tech: ['TypeScript', 'SQLite', '自托管'],
    status: 'online',
    featured: true,
    demoUrl: '/',
    highlights: [
      { label: 'themes', value: '03' },
      { label: '留言入库', value: 'SQLite' },
    ],
  },
  {
    id: 'demo-app',
    name: 'Demo App(占位)',
    desc: 'TODO: 你的第一个项目,一句话介绍它解决什么问题。部署后填 demoUrl。',
    tech: ['TODO'],
    status: 'building',
  },
  {
    id: 'demo-app2',
    name: 'Another Project(占位)',
    desc: 'TODO: 第二个项目介绍。',
    tech: ['TODO'],
    status: 'building',
  },
]

export const NAV = [
  { label: 'home', href: '/' },
  { label: 'projects', href: '/#projects' },
  { label: 'usage', href: '/#usage' },
  { label: 'about', href: '/#about' },
  { label: 'guestbook', href: '/#guestbook' },
]

export const SITE_META = {
  title: 'liuzixiang · 个人主页',
  description: '全栈工程师刘子祥的个人主页:项目 / DeepSeek 用量统计 / 简历 / 留言板。',
  keywords: ['liuzixiang', '全栈工程师', '个人主页', 'deepseek', 'token'],
}