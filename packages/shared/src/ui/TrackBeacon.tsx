'use client'

import { useEffect } from 'react'
import { trackEvent } from './track.js'

/** 一个区块最少可见多久(ms)才计入浏览,避免快速滚过造成噪声 */
const MIN_SECTION_MS = 1000
/** 区块计入浏览的最小可见高度(px):高区块也能量到,避免比例阈值对长区块失效 */
const MIN_VISIBLE_PX = 160

/** 每次页面会话只上报一次 `visit`(模块级去重;StrictMode 双跑也只算一次) */
let visitSent = false

/**
 * 页面埋点:
 * 1. 加载时上报一次 `visit`(模块级去重);
 * 2. 统计「前台可见时长」,离开时上报 `leave`(dwell 秒);
 * 3. 观察 `section[id]` 区块进入视口:可见时计时,离开视口/卸载时上报
 *    `section_view`(target=`/#id`,dwell=该区块可见秒数,≥1s 才计)。
 * 仅前台计时,后台挂机不计入。
 *
 * 注意:effect **每次都完整注册/清理**(不因去重而跳过),否则 React StrictMode
 * 的「挂载→清理→再挂载」会把监听器/observer 清掉后不再注册,导致后续事件全部丢失。
 */
export function TrackBeacon({ path = '/' }: { path?: string }) {
  useEffect(() => {
    if (!visitSent) {
      visitSent = true
      trackEvent('visit', path)
    }

    /* ---------- 整页前台停留(leave) ---------- */
    let active = typeof document !== 'undefined' && document.visibilityState === 'visible'
    let accMs = 0
    let since = active ? Date.now() : 0
    let reported = false

    const accrue = () => {
      if (active && since) accMs += Date.now() - since
      since = active ? Date.now() : 0
    }
    const reportLeave = () => {
      if (reported) return
      accrue()
      reported = true
      const dwell = Math.round(accMs / 1000)
      if (dwell > 0) trackEvent('leave', path, dwell)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        accrue()
        active = false
        reportLeave()
      } else {
        if (reported) {
          reported = false
          accMs = 0
        }
        active = true
        since = Date.now()
      }
    }
    const onPageHide = () => {
      accrue()
      reportLeave()
    }

    /* ---------- 区块浏览(section_view) ---------- */
    // 每个区块:可见时开始计时(仅前台),离开/卸载/切后台时上报可见时长。
    // 判定"算看过":可见比例 ≥ 25% 或 可见高度 ≥ 50% 视口(兼容高区块)。
    const trackers = new Map<
      Element,
      { shownAt: number; accMs: number; counted: boolean }
    >()
    const flushSection = (el: Element) => {
      const t = trackers.get(el)
      if (!t) return
      if (t.shownAt) {
        t.accMs += Date.now() - t.shownAt
        t.shownAt = 0
      }
      // 可见时长达到阈值才计(避免快速滚过)
      if (t.counted && t.accMs >= MIN_SECTION_MS) {
        const id = (el as HTMLElement).id
        const sec = Math.max(1, Math.round(t.accMs / 1000))
        trackEvent('section_view', `${path}#${id}`, sec)
      }
      t.accMs = 0
      t.counted = false
    }

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                const el = e.target
                let t = trackers.get(el)
                if (!t) {
                  t = { shownAt: 0, accMs: 0, counted: false }
                  trackers.set(el, t)
                }
                // 可见高度 ≥ 阈值(px)即视为"看过";高区块不再受比例阈值限制
                const enough = e.intersectionRect.height >= MIN_VISIBLE_PX
                if (e.isIntersecting && enough) {
                  if (!t.counted) t.counted = true
                  if (!t.shownAt && document.visibilityState === 'visible') t.shownAt = Date.now()
                } else if (!e.isIntersecting) {
                  flushSection(el)
                }
              }
            },
            { threshold: [0, 0.01, 0.25, 0.5, 1] },
          )
        : null

    const observeSections = () => {
      if (!io) return
      document.querySelectorAll('section[id]').forEach((el) => {
        if (!trackers.has(el)) {
          trackers.set(el, { shownAt: 0, accMs: 0, counted: false })
          io.observe(el)
        }
      })
    }
    observeSections()
    // 首帧后区块可能才挂载,补一次
    const t = window.setTimeout(observeSections, 1200)

    const flushAll = () => {
      trackers.forEach((_t, el) => flushSection(el))
    }
    const onVisSections = () => {
      if (document.visibilityState === 'hidden') {
        flushAll()
      }
    }
    const onPageHideSections = () => {
      flushAll()
    }

    document.addEventListener('visibilitychange', onVis)
    document.addEventListener('visibilitychange', onVisSections)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pagehide', onPageHideSections)
    return () => {
      window.clearTimeout(t)
      io?.disconnect()
      flushAll()
      document.removeEventListener('visibilitychange', onVis)
      document.removeEventListener('visibilitychange', onVisSections)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pagehide', onPageHideSections)
      reportLeave()
    }
  }, [path])

  return null
}

