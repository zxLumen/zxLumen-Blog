'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { VlogSeries, VlogStart, VlogVideo } from '../schema.js'
import { trackEvent } from './track.js'

interface HeroVlogProps {
  /** 已配置的旅行视频系列(至少一个系列含视频才渲染) */
  series: VlogSeries[]
  /** 随机起播点(服务端下发;缺省从头开始) */
  start?: VlogStart
}

/**
 * 抖音 iframe 播放器的「原生」布局尺寸:
 * - 竖屏(<730px 宽)走移动端布局,无 width/height 参数时固定 324×672(≈0.4821);
 * - 横屏(>=730px 宽)走 PC 布局,高度 = 9*width/16 + 35(控制条)。
 * 我们按原生尺寸渲染 iframe,再用 transform: scale() 缩放到卡片大小 → 不裁切。
 */
const MOBILE_W = 324
const MOBILE_H = 672
const PC_W = 740
const PC_H = Math.round((9 * PC_W) / 16 + 35)

/** 抖音官方内嵌播放器:免权限、无需 API key */
function douyinPlayerSrc(vid: string): string {
  return `https://open.douyin.com/player/video?vid=${encodeURIComponent(vid)}&autoplay=0`
}

function douyinWatchUrl(vid: string): string {
  return `https://www.douyin.com/video/${vid}`
}

/** 集数标签:有标题用标题,否则「第 N 集」 */
function epLabel(i: number, title?: string): string {
  return title && title.trim() ? title.trim() : `第 ${i + 1} 集`
}

/** 横屏判定:显式配置优先,否则按视频原始宽高自动判断(宽>高) */
function isLandscape(v: VlogVideo): boolean {
  if (v.orientation === 'landscape') return true
  if (v.orientation === 'portrait') return false
  if (v.w && v.h) return v.w > v.h
  return false
}

/**
 * 主页 Hero 右侧:抖音旅行短视频轮播(多卡重叠 + 左右滑动切换 + 左右箭头)。
 * 仅渲染当前集与左右相邻集(邻居为暂停帧预览),且只有当前集可播放(切换即重挂载,旧视频停止)。
 */
export function HeroVlog({ series, start }: HeroVlogProps) {
  const [si, setSi] = useState(start?.series ?? 0)
  const [vi, setVi] = useState(start?.video ?? 0)
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [cw, setCw] = useState(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const movedRef = useRef(false)

  const current = series[Math.min(si, series.length - 1)] ?? series[0]
  const videos = current?.videos ?? []
  const video = videos[Math.min(vi, videos.length - 1)] ?? videos[0]

  // 容器宽度(用于计算卡片重叠步长);ResizeObserver 跟随布局
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(el.clientWidth))
    ro.observe(el)
    setCw(el.clientWidth)
    return () => ro.disconnect()
  }, [series.length])

  // 数据变化(增删/重排)后收敛越界索引
  useEffect(() => {
    if (si >= series.length) setSi(Math.max(0, series.length - 1))
  }, [series.length, si])

  // 播放统计:每当某个视频成为当前播放(展示)项时上报一次
  // (抖音 iframe 跨域,无法探测内部点击播放,以后者作为「播放量」口径)
  const currentVid = video?.vid
  useEffect(() => {
    if (currentVid) trackEvent('vlog_play', currentVid)
  }, [currentVid])

  if (!current || !video) return null

  const landscape = isLandscape(video)
  const activeAspect = landscape ? PC_W / PC_H : MOBILE_W / MOBILE_H
  const activeCardW = cw > 0 ? (landscape ? cw : Math.min(300, cw * 0.78)) : landscape ? PC_W : 300
  const viewportH = activeCardW / activeAspect
  const step = activeCardW * 0.62

  const setIndex = (idx: number) => {
    setVi(Math.max(0, Math.min(videos.length - 1, idx)))
  }

  /** 指针拖动:跟手平移,松手越过阈值则切换上/下一集 */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!video || videos.length < 2) return
    const startX = e.clientX
    const startY = e.clientY
    let dx = 0
    let horiz: boolean | null = null
    movedRef.current = false
    setDragging(true)
    const move = (ev: PointerEvent) => {
      dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) movedRef.current = true
      if (horiz === null) {
        if (Math.abs(dx) > Math.abs(dy) + 4) horiz = true
        else if (Math.abs(dy) > Math.abs(dx) + 4) horiz = false
      }
      if (horiz === false) return
      const max = step || 120
      setDrag(Math.max(-max, Math.min(max, dx)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDragging(false)
      setDrag(0)
      if (horiz === true && step > 0) {
        if (dx <= -step * 0.45) setIndex(vi + 1)
        else if (dx >= step * 0.45) setIndex(vi - 1)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const goPrev = () => setIndex(vi - 1)
  const goNext = () => setIndex(vi + 1)

  return (
    <div className={`zx-vlog zx-rise${landscape ? ' is-landscape' : ''}`}>
      {series.length > 1 && (
        <div className="zx-vlog-tabs" role="tablist" aria-label="视频系列">
          {series.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === si}
              className={`zx-vlog-tab${i === si ? ' is-active' : ''}`}
              onClick={() => {
                setSi(i)
                setVi(0)
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div
        ref={wrapRef}
        className={`zx-vlog-carousel${dragging ? ' is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        role="group"
        aria-label="短视频轮播"
      >
        <div className="zx-vlog-viewport">
          {videos.map((v, i) => {
            const d = i - vi
            if (Math.abs(d) > 2) return null
            const active = d === 0
            const useImage = Math.abs(d) <= 1
            const ls = isLandscape(v)
            const aspect = ls ? PC_W / PC_H : MOBILE_W / MOBILE_H
            const playerW = ls ? PC_W : MOBILE_W
            const playerH = ls ? PC_H : MOBILE_H
            const cardWidth = Math.round(viewportH * aspect)
            const iframeScale = cardWidth / playerW
            const x = d * step + drag
            const style = {
              '--dx': `${x}px`,
              '--sc': String(active ? 1 : 0.82),
              '--op': String(active ? 1 : Math.abs(d) === 1 ? 0.5 : 0.18),
              '--z': String(10 - Math.abs(d)),
              '--card-aspect': String(aspect),
              '--player-w': `${playerW}px`,
              '--player-h': `${playerH}px`,
              '--iframe-scale': String(iframeScale),
              width: `${cardWidth}px`,
              aspectRatio: String(aspect),
            } as CSSProperties
            return (
              <div
                key={`${v.vid}-${i}`}
                className={`zx-vlog-card${active ? ' is-active' : ''}`}
                style={style}
                aria-hidden={!active}
                onClick={
                  active
                    ? undefined
                    : () => {
                        if (!movedRef.current) setIndex(i)
                      }
                }
              >
                {useImage ? (
                  <iframe
                    // active 变化时重挂载 iframe → 旧视频立即停止(抖音跨域无法直接暂停)
                    key={`${v.vid}:${active ? 'play' : 'idle'}`}
                    className="zx-vlog-iframe"
                    src={douyinPlayerSrc(v.vid)}
                    title={epLabel(i, v.title)}
                    referrerPolicy="unsafe-url"
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                    allowFullScreen
                    scrolling="no"
                    loading={active ? undefined : 'lazy'}
                    tabIndex={active ? undefined : -1}
                  />
                ) : (
                  <div className="zx-vlog-ghost">
                    <span className="zx-vlog-ghost-n">{i + 1}</span>
                    <span className="zx-vlog-ghost-t">{epLabel(i, v.title)}</span>
                  </div>
                )}
                {!active && useImage && <span className="zx-vlog-card-badge">{i + 1}</span>}
              </div>
            )
          })}
        </div>

        {videos.length > 1 && (
          <>
            <button
              type="button"
              className="zx-vlog-arrow is-prev"
              aria-label="上一集"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={goPrev}
              disabled={vi === 0}
            >
              ‹
            </button>
            <button
              type="button"
              className="zx-vlog-arrow is-next"
              aria-label="下一集"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={goNext}
              disabled={vi === videos.length - 1}
            >
              ›
            </button>
          </>
        )}
      </div>

      <div className="zx-vlog-meta">
        <span className="zx-vlog-now" title={epLabel(vi, video.title)}>
          {epLabel(vi, video.title)}
        </span>
        <span className="zx-vlog-count">
          {vi + 1} / {videos.length}
        </span>
      </div>

      {videos.length > 1 && (
        <div className="zx-vlog-episodes" aria-label="集数">
          {videos.map((v, i) => (
            <button
              key={`${v.vid}-${i}`}
              type="button"
              className={`zx-vlog-ep${i === vi ? ' is-active' : ''}${isLandscape(v) ? ' is-landscape' : ''}`}
              title={`${epLabel(i, v.title)}${isLandscape(v) ? ' · 横屏' : ''}`}
              onClick={() => setIndex(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <a className="zx-vlog-link" href={douyinWatchUrl(video.vid)} target="_blank" rel="noreferrer">
        在抖音观看 ↗
      </a>
    </div>
  )
}
