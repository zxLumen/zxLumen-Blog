/** 悬浮件拖拽的通用逻辑:靠近视口边缘一定距离则吸附到该边 */

export const FLOAT_MARGIN = 4
/** 距边缘多少像素内触发吸附 */
export const SNAP_DISTANCE = 28

/**
 * 单轴吸附:`v` 为当前坐标,`max` 为该轴最大可用坐标(视口 − 元素尺寸 − MARGIN)。
 */
export function snapEdge(v: number, max: number): number {
  if (v <= FLOAT_MARGIN + SNAP_DISTANCE) return FLOAT_MARGIN
  if (v >= max - SNAP_DISTANCE) return max
  return v
}

/** 悬浮件与右侧应用栏之间留的缝 */
export const DOCK_GAP = 8

/**
 * 右侧应用栏(`<html data-apps="1">`)占掉的宽度,悬浮件要给它让开。
 *
 * 悬浮件的坐标是 JS 算好后写成**行内** `left/top` + `right:auto` 的
 * (拖拽吸附要用),行内样式优先级高于样式表,所以纯 CSS 覆盖不了 ——
 * 必须在算坐标时就把这段宽度减掉,拖拽/吸附/初始位置才会一致。
 *
 * 窄屏(≤820px)时应用栏变成底部横条,不占右侧,返回 0。
 */
export function rightGutter(): number {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 0
  if (document.documentElement.getAttribute('data-apps') !== '1') return 0
  if (window.innerWidth <= 820) return 0
  const cs = getComputedStyle(document.documentElement)
  const w = parseFloat(cs.getPropertyValue('--zx-dock-w'))
  if (!Number.isFinite(w) || w <= 0) return 0
  // 竖栏自身的内缩(window 布局 22px)也要算进去,否则悬浮件会压住竖栏
  const inset = parseFloat(cs.getPropertyValue('--zx-dock-inset-r'))
  return w + DOCK_GAP + (Number.isFinite(inset) && inset > 0 ? inset : 0)
}

/**
 * 元素宽度为 `w` 时,x 方向能到的最右位置(已扣除右侧应用栏)。
 * 拖动过程中、读回历史位置时都要用它夹一下,否则能把悬浮件拖到应用栏底下、
 * 或让「上次拖到边上」的老位置在有应用栏后继续压着它。
 */
export function maxX(w: number, margin = FLOAT_MARGIN): number {
  if (typeof window === 'undefined') return margin
  return Math.max(margin, window.innerWidth - w - margin - rightGutter())
}

/**
 * 悬浮件改由 CSS 定位(左下角堆叠)的断点,与样式里的 @media (max-width: 820px) 一致。
 */
export const NARROW_MAX = 820

/**
 * 是否处于窄屏。
 *
 * 窄屏下悬浮件的坐标由 CSS 负责(左下角堆叠,已避开顶栏与底部应用栏),
 * **不再套用拖拽 / localStorage 里的旧坐标**:那套坐标是按桌面算的,写成行内
 * left/top 后优先级高于样式表,会把悬浮件重新拽回桌面位置(窄屏上可能出屏)。
 * 桌面(> 820px)维持原样,拖拽/吸附/存档完全不变。
 */
export function isNarrow(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth <= NARROW_MAX
}

/**
 * 窄屏时底部应用栏(底部横条)占据的高度,悬浮件要向上让开;其余情况返回 0。
 *
 * 桌面应用栏在右侧(见 rightGutter);窄屏它变成贴底的横条,占的是**底部**,
 * 所以要让的是 Y 方向。悬浮件坐标同样是行内样式,样式表里给 .zxchat-fab 等写的
 * `bottom: calc(var(--zx-dock-h) + …)` 会被行内 `top` 盖掉,因此必须在算坐标时扣除。
 */
export function bottomGutter(): number {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 0
  if (document.documentElement.getAttribute('data-apps') !== '1') return 0
  if (window.innerWidth > NARROW_MAX) return 0
  const h = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--zx-dock-h'),
  )
  return Number.isFinite(h) && h > 0 ? h : 0
}

