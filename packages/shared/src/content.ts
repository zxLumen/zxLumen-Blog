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
  /** 状态:online 已投产 / demo 演示中 / building 建设中 / archived 归档 */
  status: 'online' | 'demo' | 'building' | 'archived'
  /** 时间区间,如 '2025.04 — 2025.10' */
  period?: string
  /** 部署在你自己服务器上的子域名,如 demo1.yourdomain.com(无域名时留空) */
  demoUrl?: string
  repoUrl?: string
  /** 亮点数字/指标 */
  highlights?: { label: string; value: string }[]
  featured?: boolean
}

// ===========================================================================
// 资料内容(依据简历整理;可随时更新)
// ===========================================================================

export const PROFILE = {
  name: '刘子祥',
  handle: 'liuzixiang',
  shell: 'lz@zx.dev',
  title: '后端研发工程师 · MLOps / LLMOps',
  location: '中国 · 北京',
  email: '422206217@qq.com',
  bioLines: [
    '6 年互联网研发经验,先后任职百度(DuerOS · KG · BDG · ACG)与腾讯 TEG 数据平台部。',
    '专注后端与 AI 工程化:MLOps / LLMOps、Ray、模型调度与推理服务、大模型应用。',
    '主语言 Python,喜欢把算法与工程打通,让模型稳定高效地跑在生产线上。',
  ],
  statusLine: 'Python · MLOps/LLMOps · Ray · 模型服务',
}

export const LINKS: LinkItem[] = [
  { label: 'email', url: 'mailto:422206217@qq.com' },
  { label: 'resume', url: '/resume.pdf' },
  { label: 'github', url: '' },
]

const T = (name: string, level: number, tags: string[]): TechItem => ({ name, level, tags })

export const TECH: TechItem[] = [
  T('Python', 0.95, ['精通', 'backend']),
  T('MLOps / LLMOps', 0.9, ['精通', 'model-scheduler']),
  T('Ray / Ray Serve', 0.85, ['精通', 'distributed']),
  T('FastAPI / Django / Gunicorn', 0.85, ['精通', 'service']),
  T('Redis / MySQL', 0.8, ['熟悉', 'storage']),
  T('Kafka / MQTT / Nats', 0.78, ['熟悉', 'messaging']),
  T('Docker / K8s', 0.8, ['熟悉', 'deploy']),
  T('Grafana / Prometheus', 0.72, ['熟悉', 'observability']),
  T('LangChain / Langflow', 0.8, ['熟悉', 'llm-app']),
  T('C / C++ / 声学算法', 0.7, ['熟悉', 'Kaldi', 'AEC', 'ASR']),
  T('Java / Golang', 0.5, ['了解']),
  T('Deep Learning / ML', 0.6, ['了解', 'Data Science']),
]

export const TIMELINE: TimelineEntry[] = [
  {
    period: '2025.04 — 2025.10',
    title: '后端研发工程师',
    org: '腾讯 · TEG 数据平台部',
    desc: '负责音频预处理算子与主管线编排:基于 Ray 的管线框架,消息队列/存储链路优化;已完成 17 个算子、4 条主管线并投产。',
  },
  {
    period: '2018.07 — 2023.10',
    title: '后端 / 算法研发工程师',
    org: '百度(DuerOS · KG · BDG · ACG)',
    desc: '语音算法(AEC/ASR/声纹)、互动关系网络与图学习、工业优化套件、工业大模型服务(度安安等)的设计与核心研发。',
  },
  {
    period: '2014.09 — 2018.07',
    title: '计算机科学与技术 · 本科',
    org: '山东理工大学',
    desc: '集训队 2014 级队长;ICPC 亚洲区域赛金牌、CCPC 银牌、CCCC 团体天梯赛一等奖等,获国家奖学金。',
  },
]

export const PROJECTS: Project[] = [
  {
    id: 'audio-pipeline',
    period: '2025.04 — 2025.10',
    name: '音频预处理管线 / 主管线框架',
    desc: '腾讯 TEG:音频算子研发与主管线编排,基于 Ray 构建管线框架,替代 Spark 投产链路,支持多优先级插队与资源混部。',
    tech: ['Python', 'Ray', 'MLOps', 'Model Scheduler', 'MQProxy'],
    status: 'online',
    featured: true,
    highlights: [
      { label: '算子 / 管线', value: '17 / 4' },
      { label: '日产能', value: '+2~4x' },
    ],
  },
  {
    id: 'windmill',
    period: '2023.07 — 2023.10',
    name: 'Windmill — 工业大模型服务',
    desc: '百度 ACG:大模型应用服务化框架(RayServe + FastAPI + Websocket),支持 APP/Host 分离部署与低代码大模型应用构建。',
    tech: ['LLMOps', 'Ray Serve', 'FastAPI', 'LangChain', 'Langflow'],
    status: 'online',
    featured: true,
    highlights: [
      { label: '大模型 APP', value: '20+' },
      { label: '定制应用', value: '200+' },
    ],
  },
  {
    id: 'soe',
    period: '2023.04 — 2023.07',
    name: 'SOE — 工业仿真优化系统',
    desc: '百度 ACG:数采 + 模型推理 + 控制的通用仿真优化系统,负责推理系统设计与研发,应用于中海油、隆鑫发动机检测等。',
    tech: ['Python', 'Ray', 'Nats', 'Streamz', 'MQTT', 'K8s'],
    status: 'online',
    highlights: [
      { label: '发布会', value: '2023 云智大会' },
      { label: '场景', value: '中海油 / 隆鑫' },
    ],
  },
  {
    id: 'ifactory',
    period: '2022.01 — 2023.04',
    name: 'iFactory Suites — 生产过程优化套件',
    desc: '百度 KG:MPO-Tools + MPO-Service + MPO-Plant 工业优化套件,提供核心算子、模型服务与跨产线自学习,多工业领域投产。',
    tech: ['Python', 'Django', 'MLOps', 'Kafka', 'Docker'],
    status: 'online',
    highlights: [
      { label: '领域', value: '轧钢/水冷/冲压/镀锌/制丝' },
    ],
  },
  {
    id: 'social-graph',
    period: '2020.05 — 2022.01',
    name: '互动关系网络模型优化',
    desc: '百度 BDG:用户互动关系网络的模型与性能优化,引入 Metapath2vec 与分布式游走,支撑 10 亿+ 用户、600 亿+ 关系。',
    tech: ['Paddle', 'PGL', 'GraphLearning', 'MapReduce', 'Embedding'],
    status: 'online',
    featured: true,
    highlights: [
      { label: 'AUC', value: '+2.2%' },
      { label: '规模', value: '600亿+ 关系' },
    ],
  },
  {
    id: 'asr-aec',
    period: '2018.07 — 2020.05',
    name: '语音算法:ASR / AEC / 声纹',
    desc: '百度 DuerOS:回声消除(AEC)、ASR 解码器 C++→C 迁移与优化、无感知声纹注册,应用于耳机/车载支架/音箱等产品。',
    tech: ['C/C++', 'Kaldi', 'AEC', 'ASR', 'Speaker Recognition'],
    status: 'archived',
    highlights: [
      { label: '识别时间', value: '-30%' },
      { label: 'AEC CPU', value: '-8%' },
    ],
  },
  {
    id: 'zx-home',
    name: '本页 · 个人主页',
    desc: '自托管个人主页:Next.js + SQLite,多主题/布局、留言板(回复分页)、DeepSeek 用量面板、站长后台与测试模式。',
    tech: ['Next.js', 'TypeScript', 'SQLite', 'Docker', 'Caddy'],
    status: 'online',
    demoUrl: '/',
    highlights: [
      { label: '主题', value: '6' },
      { label: '自托管', value: 'VPS' },
    ],
  },
]

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

export const SITE_META = {
  title: '刘子祥 · 后端研发工程师',
  description:
    '刘子祥,后端研发工程师,6 年互联网研发经验(腾讯 / 百度),专注 MLOps / LLMOps、Ray 与模型服务。',
  keywords: ['刘子祥', '后端研发工程师', 'Python', 'MLOps', 'LLMOps', 'Ray', '个人主页'],
}
