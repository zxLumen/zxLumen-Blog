'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { AppItem } from '../schema.js'
import { trackEvent } from './track.js'

/** 卡片「3 秒仍可见」的判定窗口 */
const S3_MS = 3000
/** 可见阈值:intersectionRatio ≥ 0.5 才算曝光(与区块浏览同一口径) */
const VISIBLE_RATIO = 0.5

/**
 * 应用卡片曝光埋点:用 IntersectionObserver 观察应用栏里的每个 `[data-app-id]`。
 *
 * 口径(与 docs/RESEARCH-douyin-app-platform-2026-11-11.md 的 s3 一致):
 *  - 卡片可见(≥50%)→ 上报 `app_impression`(dwell=0,带 app id / 位置 / 会话 id);
 *  - 3s 后仍可见且页面在前台 → 再报一条 `app_impression`(dwell=3)。
 *    聚合时 dwell=3 的数量 ÷ dwell=0 的数量 = s3。
 *  - 每次挂载内每张卡只计一次曝光,滚动来回不会重复上报(刷新 = 新的一次曝光)。
 *  - 不做 video 相关采集。
 */
export function useAppImpressions(navRef: RefObject<HTMLElement | null>, apps: AppItem[]): void {
  /** 依赖用 id 串:数组每次渲染都是新引用,直接进依赖会白跑 */
  const idsKey = apps.map((a) => a.id).join(' ')
  const seen = useRef(new Set<string>())
  const visible = useRef(new Map<string, boolean>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const nav = navRef.current
    if (!nav || typeof IntersectionObserver === 'undefined') return
    const indexOf = (id: string) => apps.findIndex((a) => a.id === id)

    const report = (id: string) => {
      if (seen.current.has(id)) return
      seen.current.add(id)
      const pos = indexOf(id)
      trackEvent('app_impression', id, 0, { pos })
      const t = setTimeout(() => {
        timers.current.delete(id)
        if (!visible.current.get(id)) return
        // 切到后台不算「仍在页面」;回来也不会补记,避免虚高
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        trackEvent('app_impression', id, S3_MS / 1000, { pos })
      }, S3_MS)
      timers.current.set(id, t)
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.appId
          if (!id) continue
          const on = e.isIntersecting && e.intersectionRatio >= VISIBLE_RATIO
          visible.current.set(id, on)
          if (on && document.visibilityState === 'visible') report(id)
        }
      },
      { threshold: [0, VISIBLE_RATIO, 1] },
    )
    nav.querySelectorAll<HTMLElement>('[data-app-id]').forEach((el) => io.observe(el))

    const onVisibility = () => {
      if (document.visibilityState === 'visible') return
      for (const id of visible.current.keys()) visible.current.set(id, false)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // 只按 id 串和 ref 重连;apps 从本次闭包取,重排后 indexOf 仍是新顺序
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, navRef])

  // 卸载时清掉还没到点的 3s 计时器(重连观察器时不清,免得拖动一下就把 s3 丢了)
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const t of pending.values()) clearTimeout(t)
      pending.clear()
    }
  }, [])
}
