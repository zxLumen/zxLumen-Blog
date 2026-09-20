export type Texture = 'scanlines' | 'aurora' | 'grid' | 'dots' | 'noise' | 'horizon' | 'none'
export type Mode = 'dark' | 'light'

export interface Theme {
  id: string
  label: string
  /** 一句话风格说明 */
  tagline: string
  /** hero 首屏打字机文案 */
  heroLine: string
  /** ascii 示意图 */
  motif: string
  /** 快捷键(按展示顺序分配) */
  key: string
  texture: Texture
  mode: Mode
  /** 主色,用于选择器色块 */
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

// 未使用的 motif 保留,便于以后加回主题
void MOTIF_BLOCK
void MOTIF_CITY

/* ---------- 6 套主题(快捷键 1–6) ---------- */

export const THEMES: Theme[] = [
  {
    id: 'github-light',
    label: 'GITHUB',
    tagline: 'GitHub Light · 开发者熟面孔',
    heroLine: '// main is green — 主干是绿的',
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
]

/* ---------- 布局:只保留 SIDEBAR(第 3 个) ---------- */

export const LAYOUTS: Layout[] = [
  { id: 'sidebar', label: 'SIDEBAR', tagline: '侧栏:左侧竖排导航,IDE 感', key: '3' },
]

export const DEFAULT_THEME = 'github-light'
export const DEFAULT_LAYOUT: LayoutId = 'sidebar'

export const THEME_IDS = THEMES.map((t) => t.id)
export const LAYOUT_IDS = LAYOUTS.map((l) => l.id)

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
 * 内联到 <head> 的无闪烁脚本:首帧前把 theme/layout/texture/mode 写到 <html>。
 * 主题与布局都持久化在 localStorage。
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var T=${JSON.stringify(THEME_IDS)},Tm=${JSON.stringify(THEME_MAP)},L=${JSON.stringify(LAYOUT_IDS)};
var D=document.documentElement;
var th=localStorage.getItem('${THEME_STORAGE_KEY}');if(T.indexOf(th)<0)th='${DEFAULT_THEME}';
var ly=localStorage.getItem('${LAYOUT_STORAGE_KEY}');if(L.indexOf(ly)<0)ly='${DEFAULT_LAYOUT}';
var info=Tm[th]||{t:'none',m:'dark'};
D.dataset.theme=th;D.dataset.layout=ly;D.dataset.texture=info.t;D.dataset.mode=info.m;
}catch(e){document.documentElement.dataset.theme='${DEFAULT_THEME}';document.documentElement.dataset.layout='${DEFAULT_LAYOUT}';document.documentElement.dataset.texture='none';document.documentElement.dataset.mode='dark'}})()`
