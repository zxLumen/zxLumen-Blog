'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TipState {
  label: string
  x: number
  y: number
}

const GAP = 14
const MARGIN = 8
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * 柱状图「跟随鼠标」提示:把返回的 onMouseMove/onMouseLeave 挂在柱子容器上,
 * 并把返回的 node 渲染在容器内即可。提示读取被 hover 柱子的 `data-label`,
 * 用 portal 固定定位(不受容器 overflow 裁剪),并**自动收敛到视口内**(不出屏)。
 */
export function useBarTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-label]') as HTMLElement | null
    if (!el) {
      setTip((t) => (t ? null : t))
      return
    }
    setTip({ label: el.dataset.label || '', x: e.clientX, y: e.clientY })
  }, [])

  const onMouseLeave = useCallback(() => setTip(null), [])

  // 渲染后测量尺寸并把提示夹在视口内(优先右下,越界则翻到左上)
  useIsoLayoutEffect(() => {
    if (!tip || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    let left = tip.x + GAP
    let top = tip.y + GAP
    if (left + r.width > window.innerWidth - MARGIN) left = tip.x - r.width - GAP
    if (top + r.height > window.innerHeight - MARGIN) top = tip.y - r.height - GAP
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - r.width - MARGIN))
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - r.height - MARGIN))
    setPlaced({ left, top })
  }, [tip])

  const node =
    tip && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={ref}
            className="zx-bartip"
            style={{ left: placed?.left ?? tip.x + GAP, top: placed?.top ?? tip.y + GAP }}
          >
            {tip.label}
          </div>,
          document.body,
        )
      : null

  return { onMouseMove, onMouseLeave, node }
}
