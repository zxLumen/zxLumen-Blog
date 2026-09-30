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
  const w = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--zx-dock-w'),
  )
  return Number.isFinite(w) && w > 0 ? w + DOCK_GAP : 0
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

