export type Texture = 'scanlines' | 'aurora' | 'grid' | 'dots' | 'noise' | 'horizon' | 'none'
export type Mode = 'dark' | 'light'

export interface Theme {
  id: string
  label: string
  tagline: string
  heroLine: string
  motif: string
  key: string
  texture: Texture
  mode: Mode
  swatch: [string, string, string]
}

export type LayoutId =
  | 'classic'
  | 'centered'
  | 'sidebar'
  | 'window'
  | 'hud'
  | 'magazine'
  | 'fullbleed'
  | 'bento'
  | 'compact'
  | 'showcase'

export interface Layout {
  id: LayoutId
  label: string
  tagline: string
  key: string
}

/* ---------- ascii motifs ---------- */

const MOTIF_BLOCK = [
  '    ▄▄▄▄▄▄▄  ',
  '  ▄█████████▄',
  '  ████████████',
  '  ████████████',
  '  ████ ████ ██   lz@zx.dev',
  '  ████▀▀▀▀████',
  '  ▀▀▀▀▀▀▀▀▀▀▀▀  [root@main ~]#',
].join('\n')

const MOTIF_BOX = [
  '      ──────      ',
  '   ┌──────────┐   ',
  '   │ ▓▓  ▓▓  ▓│   ',
  '   │ ▓▓  ▓▓  ▓│   lz@zx.dev',
  '   │ ▓▓▓▓▓▓  ▓│   ',
  '   └──────────┘   ',
  '   ✦ ⚡ ✦  ✦ ✦ ⚡  ',
].join('\n')

const MOTIF_FRAME = [
  '  ┌──────────────────┐',
  '  │              ▣   │',
  '  │  ▓▓▓  ▓▓▓    │   │',
  '  │  ▓▓▓  ▓▓▓    │   │  lz@zx.dev',
  '  │  ──────────  │   │',
  '  │         PRESENCE │',
  '  └──────────────────┘',
].join('\n')

const MOTIF_SUN = [
  '        ▄▄▄▄▄▄▄▄        ',
  '     ▄██████████▄     ',
  '   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   lz@zx.dev',
  '   ══════════════════  ',
  '    ╱  ╱  ╱  ╱  ╱  ╱    ',
  '   ╱  ╱  ╱  ╱  ╱  ╱     ',
  '  ╱__╱__╱__╱__╱__╱      ',
].join('\n')

const MOTIF_CITY = [
  '      ▄▄  ▄▄▄▄  ▄▄        ',
  '   ▄  ██  ████  ██  ▄     ',
  '   ██ ██  ████  ██ ██  ◉  ',
  '   ██ ██  ████  ██ ██     ',
  '   ██████████████████     lz@zx.dev',
  '   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔     ',
].join('\n')

const MOTIF_WAVE = [
  '   ╭──────────────────╮ ',
  '   │  ~~~~~~~~~~~~~~~ │ ',
  '   │  ~ CODE · SHIP ~ │ lz@zx.dev',
  '   │  ~~~~~~~~~~~~~~~ │ ',
  '   │  >> build OK     │ ',
  '   ╰──────────────────╯ ',
].join('\n')

/* ---------- 18 套主题:全部可选,放行集合由 admin 配置(默认全放行) ---------- */

export const THEMES: Theme[] = [
  {
    id: 'github-light',
    label: 'GITHUB',
    tagline: 'GitHub Light · 开发者熟面孔',
    heroLine: '// Just do it — 说干就干',
    key: '1',
    texture: 'none',
    mode: 'light',
    swatch: ['#ffffff', '#0969da', '#cf222e'],
    motif: MOTIF_WAVE,
  },
  {
    id: 'nord',
    label: 'NORD',
    tagline: '北欧冷蓝灰 · 克制柔和',
    heroLine: '// calm, cold, and compiled — 冷静而克制',
    key: '2',
    texture: 'aurora',
    mode: 'dark',
    swatch: ['#2e3440', '#88c0d0', '#b48ead'],
    motif: MOTIF_FRAME,
  },
  {
    id: 'synthwave',
    label: 'SYNTHWAVE',
    tagline: '紫粉落日 · 地平线网格 · 八字头',
    heroLine: '▸ 驶向落日的最后一班列车,启动',
    key: '3',
    texture: 'horizon',
    mode: 'dark',
    swatch: ['#1a0b2e', '#ff5ea8', '#00d1ff'],
    motif: MOTIF_SUN,
  },
  {
    id: 'dracula',
    label: 'DRACULA',
    tagline: '暗紫血红 · 编辑器经典',
    heroLine: '// night-mode: on — 与吸血鬼一起写代码',
    key: '4',
    texture: 'noise',
    mode: 'dark',
    swatch: ['#1e1f29', '#bd93f9', '#ff79c6'],
    motif: MOTIF_WAVE,
  },
  {
    id: 'rose-pine',
    label: 'ROSE PINE',
    tagline: '松玫低饱和 · 温柔暗色',
    heroLine: '// under the pine — 松林之下',
    key: '5',
    texture: 'aurora',
    mode: 'dark',
    swatch: ['#191724', '#eb6f92', '#9ccfd8'],
    motif: MOTIF_BOX,
  },
  {
    id: 'minimal',
    label: 'MINIMAL',
    tagline: '蓝图极简 · 大字号 · 黑白信噪比',
    heroLine: '01 / 全栈工程师,专注于把想法变成产品',
    key: '6',
    texture: 'grid',
    mode: 'dark',
    swatch: ['#07070b', '#00a2ff', '#ffd60a'],
    motif: MOTIF_FRAME,
  },
  {
    id: 'terminal',
    label: 'TERMINAL',
    tagline: '矩阵终端 · CRT 扫描线 · 荧光绿',
    heroLine: '$ whoami — 全栈工程师 · 折腾永动机',
    key: 'q',
    texture: 'scanlines',
    mode: 'dark',
    swatch: ['#040b07', '#00ff7a', '#3dfcff'],
    motif: MOTIF_BLOCK,
  },
  {
    id: 'neon',
    label: 'NEON',
    tagline: '赛博霓虹 · 玻璃拟态 · 辉光粒子',
    heroLine: '// pulse: 全栈工程师 · 正在点亮赛博空间',
    key: 'w',
    texture: 'aurora',
    mode: 'dark',
    swatch: ['#06020f', '#ff2bd6', '#00e5ff'],
    motif: MOTIF_BOX,
  },
  {
    id: 'amber',
    label: 'AMBER',
    tagline: '复古琥珀单色终端 · 旧显示器',
    heroLine: '$ ssh zx@main — 启动琥珀模式',
    key: 'e',
    texture: 'scanlines',
    mode: 'dark',
    swatch: ['#120a02', '#ffb000', '#ff7a1a'],
    motif: MOTIF_BLOCK,
  },
  {
    id: 'cyber',
    label: 'CYBERPUNK',
    tagline: '警示黄 · 故障噪点 · 硬件朋克',
    heroLine: '> 系统就绪 // 港区在线 // 别踩黄线',
    key: 'r',
    texture: 'noise',
    mode: 'dark',
    swatch: ['#0a0a08', '#f7ff00', '#ff2d95'],
    motif: MOTIF_CITY,
  },
  {
    id: 'tokyo',
    label: 'TOKYO NIGHT',
    tagline: '靛蓝夜色 · 城市霓虹 · 点阵',
    heroLine: '24F — 俯瞰东京湾,代码与霓虹同频',
    key: 't',
    texture: 'dots',
    mode: 'dark',
    swatch: ['#0b1020', '#6b8afd', '#f7768e'],
    motif: MOTIF_CITY,
  },
  {
    id: 'gruvbox',
    label: 'GRUVBOX',
    tagline: '暖土retro · 琥珀与橄榄',
    heroLine: '$ tmux attach — 回到温暖的终端',
    key: 'y',
    texture: 'noise',
    mode: 'dark',
    swatch: ['#1d2021', '#fabd2f', '#fe8019'],
    motif: MOTIF_BLOCK,
  },
  {
    id: 'solarized-dark',
    label: 'SOLARIZED',
    tagline: 'Solarized Dark · 护眼经典配色',
    heroLine: '$ which precision | grep me',
    key: 'u',
    texture: 'none',
    mode: 'dark',
    swatch: ['#002b36', '#2aa198', '#b58900'],
    motif: MOTIF_WAVE,
  },
  {
    id: 'monokai',
    label: 'MONOKAI',
    tagline: 'Monokai · 高饱和语法高亮',
    heroLine: '// hot off the compiler — 刚出编译器',
    key: 'i',
    texture: 'noise',
    mode: 'dark',
    swatch: ['#272822', '#a6e22e', '#f92672'],
    motif: MOTIF_WAVE,
  },
  {
    id: 'catppuccin',
    label: 'CATPPUCCIN',
    tagline: '柔和马卡龙 · 舒适养眼',
    heroLine: '// mocha blend — 一杯猫唇咖啡的时间',
    key: 'o',
    texture: 'dots',
    mode: 'dark',
    swatch: ['#1e1e2e', '#cba6f7', '#89dceb'],
    motif: MOTIF_BOX,
  },
  {
    id: 'paper',
    label: 'PAPER',
    tagline: '米白纸张 · 墨黑 · 野蛮主义',
    heroLine: 'IN PRINT — 把代码印在纸上',
    key: 'p',
    texture: 'grid',
    mode: 'light',
    swatch: ['#f4f0e6', '#c2410c', '#1d4ed8'],
    motif: MOTIF_FRAME,
  },
  {
    id: 'solarized-light',
    label: 'SOLARIZED LT',
    tagline: 'Solarized Light · 温纸护眼',
    heroLine: '// daylight build — 白昼构建',
    key: 'a',
    texture: 'none',
    mode: 'light',
    swatch: ['#fdf6e3', '#268bd2', '#cb4b16'],
    motif: MOTIF_WAVE,
  },
  {
    id: 'nord-light',
    label: 'NORD LIGHT',
    tagline: '北欧浅蓝 · 清爽纸感',
    heroLine: '// bright and tidy — 明亮而整洁',
    key: 's',
    texture: 'grid',
    mode: 'light',
    swatch: ['#eceff4', '#5e81ac', '#bf616a'],
    motif: MOTIF_FRAME,
  },
]

/* ---------- 10 套布局:全部可选,放行集合由 admin 配置(默认全放行) ---------- */

export const LAYOUTS: Layout[] = [
  { id: 'classic', label: 'CLASSIC', tagline: '经典:左文右 ASCII,卡片网格', key: '1' },
  { id: 'centered', label: 'CENTERED', tagline: '居中:大字聚焦,单列', key: '2' },
  { id: 'sidebar', label: 'SIDEBAR', tagline: '侧栏:左侧竖排导航,IDE 感', key: '3' },
  { id: 'window', label: 'WINDOW', tagline: '终端窗口:全站套进带红绿灯的窗口', key: '4' },
  { id: 'hud', label: 'HUD', tagline: 'HUD:数据条 + 四角括号,科幻仪表', key: '5' },
  { id: 'magazine', label: 'MAGAZINE', tagline: '杂志:超大标题 + 章节编号 + 宽留白', key: '6' },
  { id: 'fullbleed', label: 'FULLBLEED', tagline: '全幅:通栏满屏,分节横线', key: '7' },
  { id: 'bento', label: 'BENTO', tagline: '便当盒:分区块状拼贴', key: '8' },
  { id: 'compact', label: 'COMPACT', tagline: '紧凑:小字号高密度,信息流', key: '9' },
  { id: 'showcase', label: 'SHOWCASE', tagline: '展示:视觉优先,ASCII 主视觉', key: '0' },
]

/** 出厂默认(admin 可改放行集合与默认项,但默认项必须在放行集内) */
export const DEFAULT_THEME = 'github-light'
export const DEFAULT_LAYOUT: LayoutId = 'sidebar'

export const THEME_IDS = THEMES.map((t) => t.id)
export const LAYOUT_IDS = LAYOUTS.map((l) => l.id)

/**
 * 外观放行配置(admin 可配):访客可选的主题/布局集合 + 默认选中项。
 * 默认项必须包含在放行集合内(由 API 与读取端保证)。
 */
export interface AppearanceConfig {
  themes: string[]
  layouts: LayoutId[]
  defaultTheme: string
  defaultLayout: LayoutId
}

/** 出厂默认配置:全部放行,默认 github-light / sidebar */
export const DEFAULT_APPEARANCE: AppearanceConfig = {
  themes: THEME_IDS,
  layouts: LAYOUT_IDS,
  defaultTheme: DEFAULT_THEME,
  defaultLayout: DEFAULT_LAYOUT,
}

/** meta 表存储键 */
export const APPEARANCE_META_KEY = 'appearance_config'

export const getTheme = (id: string | null | undefined): Theme =>
  THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME) ?? THEMES[0]

export const isValidTheme = (id: string | null | undefined): boolean =>
  !!id && THEMES.some((t) => t.id === id)

export const isValidLayout = (id: string | null | undefined): id is LayoutId =>
  !!id && LAYOUTS.some((l) => l.id === id)

export const THEME_STORAGE_KEY = 'zx-theme'
export const LAYOUT_STORAGE_KEY = 'zx-layout'

const THEME_MAP = THEMES.reduce<Record<string, { t: Texture; m: Mode }>>((acc, t) => {
  acc[t.id] = { t: t.texture, m: t.mode }
  return acc
}, {})

/**
 * 首帧无闪烁脚本:只接受 allowed 集合内的主题/布局,其余回退到 default(默认项)。
 * 由服务端读取 admin 配置后注入 <head>;default 始终包含在 allowed 内。
 * mockId:模拟访客身份时,主题键按身份后缀(等价于该访客设备的偏好)。
 */
export function themeInitScript(
  allowedThemes: string[],
  allowedLayouts: string[],
  defaultTheme: string,
  defaultLayout: string,
  mockId?: string,
): string {
  const themeStorageKey = `${THEME_STORAGE_KEY}${mockId ? `.${mockId}` : ''}`
  return `(function(){try{
var T=${JSON.stringify(allowedThemes)},Tm=${JSON.stringify(THEME_MAP)},L=${JSON.stringify(allowedLayouts)};
var D=document.documentElement;
var th=localStorage.getItem('${themeStorageKey}');if(T.indexOf(th)<0)th='${defaultTheme}';
var ly=localStorage.getItem('${LAYOUT_STORAGE_KEY}');if(L.indexOf(ly)<0)ly='${defaultLayout}';
var info=Tm[th]||{t:'none',m:'dark'};
D.dataset.theme=th;D.dataset.layout=ly;D.dataset.texture=info.t;D.dataset.mode=info.m;
}catch(e){document.documentElement.dataset.theme='${defaultTheme}';document.documentElement.dataset.layout='${defaultLayout}';document.documentElement.dataset.texture='none';document.documentElement.dataset.mode='dark'}})()`
}
