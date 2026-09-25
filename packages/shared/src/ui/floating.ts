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
