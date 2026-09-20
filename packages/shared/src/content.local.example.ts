// 个人资料示例 / 占位。构建前会自动复制为 content.local.ts(不入库)。
// 想自定义:直接编辑生成的 content.local.ts(它被 .gitignore 忽略,不会提交)。
import type {
  LinkItem,
  Profile,
  Project,
  SiteMeta,
  TechItem,
  TimelineEntry,
} from './content.js'

export const PROFILE: Profile = {
  name: 'Your Name',
  handle: 'yourname',
  shell: 'you@dev',
  title: '你的职位 · 你的方向',
  location: '中国 · 城市',
  email: 'you@example.com',
  bioLines: [
    '一句话介绍你自己。',
    '再写一两句你的方向与兴趣。',
  ],
  statusLine: 'Tech1 · Tech2 · Tech3',
}

export const LINKS: LinkItem[] = [
  { label: 'email', url: 'mailto:you@example.com' },
  { label: 'resume', url: '/resume.pdf' },
  { label: 'github', url: '' },
]

const T = (name: string, level: number, tags: string[]): TechItem => ({ name, level, tags })

export const TECH: TechItem[] = [
  T('TypeScript', 0.9, ['精通']),
  T('Node.js', 0.85, ['熟悉']),
]

export const TIMELINE: TimelineEntry[] = [
  {
    period: 'yyyy.mm — 至今',
    title: '职位',
    org: '公司 / 组织',
    desc: '一句简述你的职责与产出。',
  },
  {
    period: 'yyyy.mm — yyyy.mm',
    title: '学历 · 专业',
    org: '学校',
    desc: '一句简述。',
  },
]

export const PROJECTS: Project[] = [
  {
    id: 'sample',
    name: '示例项目',
    desc: '一句话介绍这个项目解决什么问题。',
    tech: ['TypeScript'],
    status: 'building',
    period: 'yyyy.mm — yyyy.mm',
    highlights: [{ label: '指标', value: '—' }],
  },
]

export const SITE_META: SiteMeta = {
  title: 'Your Name · 个人主页',
  description: '一句话站点描述。',
  keywords: ['yourname', '个人主页'],
}
