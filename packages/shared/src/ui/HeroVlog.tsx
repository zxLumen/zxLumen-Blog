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

/** 竖屏卡片宽度上限(与 CSS `.zx-vlog-carousel` 的 --card-w 保持一致) */
const PORTRAIT_CARD_W = 450

/**
 * 「就位闸门」:iframe onLoad 之后再等这么久才开闸让点击穿透。
 *
 * 抖音播放器是 onLoad 之后才异步签名取 detail、初始化 xgplayer —— onLoad 那一刻整块
 * 视频区还点不动(这一次点击会被浏览器拿去「激活」那个 frame,实测两次同样流程:一次
 * 直接起播、一次只聚焦不出声)。故开闸要留足「onLoad → 真正可播」的余量。
 *
 * 该余量强依赖网速,实测(CDP 限速,量的是 onLoad → 播放器 video.readyState>=3):
 *   正常网        455~1134ms
 *   Fast3G       1726~3389ms
 *   Fast3G+降速  1726~25434ms
 * 固定 1200ms 只够正常网;慢网下点击会穿透进一个还没就绪的播放器 → 封面退了却不出声
 * (最糟的静默失败)。所以按网速自适应,见 SLOW_LOAD_MS / ARM_SETTLE_SLOW_MS。
 * 仍留 ARM_HARD_MS 硬兜底:onLoad 迟迟不来也照样开闸,不能永远点不动。
 */
const ARM_SETTLE_MS = 1200
/** 判定「这网慢」的门槛:iframe 冷加载耗时超过它就算慢。实测快网 176~339ms、慢网 3071~3422ms,区分度很高 */
const SLOW_LOAD_MS = 800
/** 慢网时的开闸余量:覆盖实测最常见的 1726~3389ms,留一点余量 */
const ARM_SETTLE_SLOW_MS = 3600
const ARM_HARD_MS = 8000

/** 慢网判定记到本地(带 TTL):第 2 集起 iframe HTML 命中缓存、加载耗时不再反映网速,只能靠记忆 */
const SLOW_STORE_KEY = 'zx-vlog-slow'
const SLOW_TTL_MS = 30 * 60 * 1000

function readSlowNet(): boolean {
  try {
    const o = JSON.parse(localStorage.getItem(SLOW_STORE_KEY) || 'null') as { at?: number } | null
    return !!o && typeof o.at === 'number' && Date.now() - o.at < SLOW_TTL_MS
  } catch {
    return false
  }
}

function markSlowNet(loadMs: number) {
  if (!(loadMs > SLOW_LOAD_MS)) return
  try {
    localStorage.setItem(SLOW_STORE_KEY, JSON.stringify({ at: Date.now() }))
  } catch {
    /* 隐私模式等:存不了就退化成只按当次加载耗时判(首集仍能兜住) */
  }
}

/** 中央播放区半径 = max(72px, min(边长) × PLAY_ZONE);角上不响应,避免「点了没反应」的错觉 */
const PLAY_ZONE = 0.26
const PLAY_ZONE_MIN = 72

/** 封面淡出时长(与 CSS `.zx-vlog-poster` 的 transition 对齐) */
const RETIRE_FADE_MS = 240

/**
 * 退场兜底定时:闸门已开但一个信号都没收到时,到点就把封面撤掉。
 *
 * 触摸端(WebKit/iOS)点进跨域 iframe 后父页面**一个信号都收不到**:`click`/
 * `pointerdown`/`touchstart` 不跨文档边界,`document.activeElement` 也不切给那个
 * iframe(桌面 Chrome 会切)。这就是「有声音但画面被自备封面挡住」的根因 ——
 * 声音出了、封面不撤。所以触摸端必须定时兜底;桌面端信号可靠,留长一点不影响观感。
 */
const FALLBACK_TOUCH_MS = 1800
const FALLBACK_FINE_MS = 8000

/** 闸门内点中央播放区:播放键脉冲提示的时长(封面绝不消失) */
const PULSE_MS = 1400

/** 命中中央播放区?(用 client 坐标算 —— 卡片被 transform 缩放过,getBoundingClientRect 已是视觉尺寸) */
function inPlayZone(e: { clientX: number; clientY: number }, el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  const radius = Math.max(PLAY_ZONE_MIN, Math.min(r.width, r.height) * PLAY_ZONE)
  return Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) <= radius
}

/** 抖音官方内嵌播放器:免权限、无需 API key */
function douyinPlayerSrc(vid: string, autoplay = false): string {
  return `https://open.douyin.com/player/video?vid=${encodeURIComponent(vid)}&autoplay=${autoplay ? '1' : '0'}`
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
 * 卡片是否用我们自己的封面(而不是抖音播放器自带的封面层):
 *  - 横屏:必须用。抖音的 xgplayer-poster 是被裁成 3:4 的 `video.cover` 竖图,
 *    `object-fit: fill` 塞进 16:9 视频区 → 严重压扁。
 *  - 竖屏:站长自己上传了封面(`coverSrc==='user'`)就用,否则维持播放器自带封面。
 * 封面按 vid 推导为 `/vlog/<vid>.jpg`(可用 `cover` 覆盖),线上无需改库
 * ——线上库与本地库是两份,写进 DB 的路径不会自动同步,只要把图片目录传上去即可。
 * 封面 404 / 加载失败 → 一律回退 iframe 现状。
 */
function coverUrl(v: VlogVideo): string {
  const base = v.cover || `/vlog/${v.vid}.jpg`
  // 带 coverAt 版本戳:换封面后 URL 变化,不会吃到浏览器/代理的旧图缓存
  return v.coverAt ? `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(v.coverAt)}` : base
}

function usePoster(v: VlogVideo, broken: Set<string>): boolean {
  if (broken.has(v.vid)) return false
  return isLandscape(v) || v.coverSrc === 'user'
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
  /** 已点开播放的集(封面已让位给播放器) */
  const [playing, setPlaying] = useState<Set<string>>(() => new Set())
  /** 封面加载失败的集(403 / 文件没上传)→ 回退 iframe,避免出现空白卡 */
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  /** 封面图已加载完的集 → 此时才把播放器挂上暖机(不跟首屏大图抢带宽) */
  const [coverLoaded, setCoverLoaded] = useState<Set<string>>(() => new Set())
  /** 播放器 iframe 已 onLoad 的集 → 封面开始点击穿透,一次点击直接落进播放器 */
  const [ready, setReady] = useState<Set<string>>(() => new Set())
  /** 闸门已开(onLoad + 沉降期)的集 → 封面点击穿透,单击直达播放器起播 */
  const [armed, setArmed] = useState<Set<string>>(() => new Set())
  /** 封面正在淡出(淡出结束才真正摘掉;淡出期间仍穿透,补点也能进播放器) */
  const [retiring, setRetiring] = useState<Set<string>>(() => new Set())
  /** 闸门内被点了一下(脉冲提示中)的集 */
  const [pulse, setPulse] = useState<Set<string>>(() => new Set())
  /** 诊断模式:?vlogdiag=1 时在卡片角落显示「收到的最后一个事件 / 封面走哪条路退场」 */
  const [diag, setDiag] = useState<{ sig: string; how: string } | null>(null)
  const [diagOn, setDiagOn] = useState(false)
  /** 已经发起过退场的集(三条信号可能同时到达,只撤一次) */
  const retireGuardRef = useRef<Set<string>>(new Set())
  /** 组件级定时器(淡出 / 脉冲),卸载时统一清掉 */
  const timersRef = useRef<Set<number>>(new Set())
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const movedRef = useRef(false)
  /** iframe 挂载时刻:onLoad 时拿它算「冷加载耗时」,据此判网速(见 markSlowNet) */
  const mountAtRef = useRef(0)

  useEffect(() => {
    setDiagOn(new URLSearchParams(window.location.search).get('vlogdiag') === '1')
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const id of timers) clearTimeout(id)
      timers.clear()
    }
  }, [])

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

  // 播放统计:抖音 iframe 跨域,既收不到它内部的点击,也不发 postMessage 播放事件
  // (已核对播放器 3 个 bundle,postMessage 全是埋点/调试内部用途),无法直接探测「点了播放」。
  // 这里用浏览器行为反推:用户点进 iframe 时父窗口会收到 blur,且 document.activeElement
  // 变成那个 iframe 元素 —— 说明用户确实在播放器里点了(播放/暂停/进度条/全屏等)。
  // 纯被动监听,不拦截事件 → 点击照常落到播放器,交互零变化。
  // 服务端再按「同一访客每天同一集只记一次」去重(见 /api/track 的 addEventOnce)。
  const currentVid = video?.vid
  /** 本次页面访问内已上报过的集(避免重复发 beacon;跨次访问的日去重由服务端负责) */
  const reportedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!currentVid) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onWindowBlur = () => {
      if (reportedRef.current.has(currentVid)) return
      // 延后一拍再判定:若这期间页面转入后台(切标签页 / 开新窗口)则是「切走」而非「点进播放器」
      timer = setTimeout(() => {
        if (document.visibilityState !== 'visible') return
        const el = document.activeElement
        if (!(el instanceof HTMLIFrameElement) || el.dataset.vid !== currentVid) return
        reportedRef.current.add(currentVid)
        trackEvent('vlog_play', currentVid)
      }, 200)
    }
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      if (timer) clearTimeout(timer)
    }
  }, [currentVid])

  // 当前集的封面/播放器状态(开闸与退场信号都只看当前集)
  const posterActive = !!video && usePoster(video, broken)
  /** 封面已就绪 → 播放器已挂上去暖机(onLoad 迟迟不来时的硬兜底开闸用) */
  const playerWarming = posterActive && !!currentVid && coverLoaded.has(currentVid)
  /** 封面已穿透:单击直接落进播放器起播 */
  const coverThrough =
    posterActive &&
    !!currentVid &&
    armed.has(currentVid) &&
    !playing.has(currentVid) &&
    !retiring.has(currentVid)

  // 开闸:onLoad 只是播放器页面加载完,再等一段余量才让点击穿透;余量按网速自适应
  useEffect(() => {
    if (!currentVid || !ready.has(currentVid)) return
    const t = window.setTimeout(
      () => armRef.current(currentVid),
      readSlowNet() ? ARM_SETTLE_SLOW_MS : ARM_SETTLE_MS
    )
    return () => window.clearTimeout(t)
  }, [currentVid, ready])

  // 硬兜底:onLoad 迟迟不来(网络差 / 子资源被挡)也照样开闸,不能永远点不动
  useEffect(() => {
    if (!currentVid || !playerWarming) return
    const t = window.setTimeout(() => armRef.current(currentVid), ARM_HARD_MS)
    return () => window.clearTimeout(t)
  }, [currentVid, playerWarming])

  // 退场信号 ①:桌面 Chrome —— 用户点进 iframe 后 document.activeElement 会变成它
  useEffect(() => {
    if (!coverThrough || !currentVid) return
    const vid = currentVid
    const t = window.setInterval(() => {
      const el = document.activeElement
      if (el instanceof HTMLIFrameElement && el.dataset.vid === vid) retireRef.current(vid, '焦点')
    }, 120)
    return () => window.clearInterval(t)
  }, [coverThrough, currentVid])

  // 退场信号 ③:定时兜底 —— 触摸端父页面一个信号都收不到,到点必须撤
  useEffect(() => {
    if (!coverThrough || !currentVid) return
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const t = window.setTimeout(
      () => retireRef.current(currentVid, coarse ? '兜底·触摸' : '兜底·桌面'),
      coarse ? FALLBACK_TOUCH_MS : FALLBACK_FINE_MS
    )
    return () => window.clearTimeout(t)
  }, [coverThrough, currentVid])

  if (!current || !video) return null

  const landscape = isLandscape(video)
  const activeAspect = landscape ? PC_W / PC_H : MOBILE_W / MOBILE_H
  const activeCardW = cw > 0 ? (landscape ? cw : Math.min(PORTRAIT_CARD_W, cw * 0.78)) : landscape ? PC_W : PORTRAIT_CARD_W
  const viewportH = activeCardW / activeAspect
  const step = activeCardW * 0.62

  const setIndex = (idx: number) => {
    setVi(Math.max(0, Math.min(videos.length - 1, idx)))
  }

  /**
   * 点一下就让位:封面消失 + 记一次播放。
   *
   * 关键点是**这次点击要真的落在播放器里** —— 跨域 iframe 的 autoplay 请求在点击
   * 回调里发起并不可靠(浏览器策略 + 播放器只认自己的播放键),所以「挂 iframe +
   * autoplay=1」必然变成点两次。有封面时改为:播放器提前挂在封面底下暖机,闸门开过
   * 之后封面变成 pointer-events:none,点击直接穿透进播放器由它自己起播 —— 单击出声。
   * 本函数只负责**把封面撤掉**(播放已经发生了),不参与起播。
   */
  const startPlayback = (vid: string) => {
    if (!reportedRef.current.has(vid)) {
      reportedRef.current.add(vid)
      trackEvent('vlog_play', vid)
    }
    setPlaying((prev) => (prev.has(vid) ? prev : new Set(prev).add(vid)))
  }
  const startPlaybackRef = useRef(startPlayback)
  startPlaybackRef.current = startPlayback

  /** 开闸:封面开始点击穿透 */
  const arm = (vid: string) =>
    setArmed((prev) => (prev.has(vid) ? prev : new Set(prev).add(vid)))
  const armRef = useRef(arm)
  armRef.current = arm

  /** 闸门内的点击:封面绝不消失(撤了就成了「点两下」),只脉冲提示一下 */
  const pulseOnce = (vid: string) => {
    setPulse((prev) => (prev.has(vid) ? prev : new Set(prev).add(vid)))
    const t = window.setTimeout(
      () =>
        setPulse((prev) => {
          if (!prev.has(vid)) return prev
          const next = new Set(prev)
          next.delete(vid)
          return next
        }),
      PULSE_MS
    )
    timersRef.current.add(t)
  }
  const pulseRef = useRef(pulseOnce)
  pulseRef.current = pulseOnce

  /**
   * 撤封面:淡出 → 摘掉 → 记一次播放。
   *
   * 声音是「点击穿透进播放器」发出来的,父页面拿不到任何播放事件,所以撤封面只能靠
   * 三条旁证,任一命中即撤 —— 保证「有声音但画面被自备封面挡住」不可能再出现:
   *   ① activeElement 变成那个 iframe(桌面 Chrome);
   *   ② 事件真的交到了包装层(部分 WebKit 会把 iframe 上的点按交给父文档);
   *   ③ 定时兜底(触摸端必然走这条)。
   */
  const retire = (vid: string, how: string) => {
    if (retireGuardRef.current.has(vid)) return
    retireGuardRef.current.add(vid)
    setRetiring((prev) => (prev.has(vid) ? prev : new Set(prev).add(vid)))
    if (diagOn) setDiag((d) => ({ sig: d?.sig ?? '', how }))
    const t = window.setTimeout(() => startPlaybackRef.current(vid), RETIRE_FADE_MS)
    timersRef.current.add(t)
  }
  const retireRef = useRef(retire)
  retireRef.current = retire

  /**
   * 松手落在包装层上时:命中中央播放区就撤封面。
   *
   * 封面已穿透时点击根本不会走到这里(直接进播放器了),所以「走到这里」本身就说明
   * 父页面收到了这次点击(退场信号 ②)。听 pointerup / touchend 而不是 pointerdown,
   * 拖动切集时 movedRef 已经是 true,不会被误判成播放。
   */
  const onCardRelease = (e: React.PointerEvent | React.TouchEvent) => {
    if (!video || movedRef.current) return
    const card = wrapRef.current?.querySelector('.zx-vlog-card.is-active')
    if (!(card instanceof HTMLElement)) return
    const touch = 'changedTouches' in e ? e.changedTouches[0] : undefined
    const point = touch
      ? { clientX: touch.clientX, clientY: touch.clientY }
      : { clientX: (e as React.PointerEvent).clientX, clientY: (e as React.PointerEvent).clientY }
    if (!inPlayZone(point, card)) return
    const vid = video.vid
    if (diagOn) setDiag((d) => ({ sig: e.type, how: d?.how ?? '' }))
    if (armed.has(vid) && !playing.has(vid)) retireRef.current(vid, '事件到手')
    else if (usePoster(video, broken)) pulseRef.current(vid)
  }

  /** 封面图已就绪(onLoad 或 ref 自查 complete)→ 挂播放器暖机 */
  const markCoverLoaded = (vid: string) =>
    setCoverLoaded((prev) => (prev.has(vid) ? prev : new Set(prev).add(vid)))

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
        onPointerUpCapture={onCardRelease}
        onTouchEndCapture={onCardRelease}
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
            // 有自备封面的卡:封面盖在播放器之上,既避开播放器自带的 3:4 竖封面被压扁,
            // 又让播放器提前暖机;封面点击穿透后一次点击即可起播(见 startPlayback 注释)
            const poster = usePoster(v, broken)
            const started = playing.has(v.vid)
            // 有封面的当前卡:封面图一加载完就把播放器挂上暖机,封面盖在它上面
            const showPlayer = useImage && (!poster || (active && coverLoaded.has(v.vid)))
            // 闸门已开 → 封面点击穿透,单击直接进播放器起播(见 startPlayback 注释)
            const through = poster && armed.has(v.vid) && !retiring.has(v.vid) && !started
            const fading = poster && retiring.has(v.vid) && !started
            return (
              <div
                key={`${v.vid}-${i}`}
                className={`zx-vlog-card${active ? ' is-active' : ''}`}
                style={style}
                aria-hidden={!active}
                aria-busy={active && poster && !started && !armed.has(v.vid) ? true : undefined}
                onClick={
                  active
                    ? () => {
                        // 拖动滑过去的手势结束时也会触发 click,用 movedRef 挡掉
                        if (movedRef.current) return
                        // 封面已穿透时点击不会走到这里;能走到 = 还在闸门内 → 只提示不撤封面
                        if (poster && !started && !armed.has(v.vid)) pulseOnce(v.vid)
                      }
                    : () => {
                        if (!movedRef.current) setIndex(i)
                      }
                }
              >
                {showPlayer && (
                  <iframe
                    // active 变化时重挂载 iframe → 旧视频立即停止(抖音跨域无法直接暂停)
                    key={`${v.vid}:${active ? 'play' : 'idle'}`}
                    className="zx-vlog-iframe"
                    // 恒为 autoplay=0:autoplay 靠不上真手势(且 src 一变 iframe 就重新导航,
                    // 正好把用户那一下点击冲掉),起播一律由点击进播放器本身触发
                    src={douyinPlayerSrc(v.vid)}
                    title={epLabel(i, v.title)}
                    referrerPolicy="unsafe-url"
                    allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                    allowFullScreen
                    scrolling="no"
                    loading={active ? undefined : 'lazy'}
                    // data-vid:播放统计用它判断「用户点进的正是当前集」(见上方 blur 监听)
                    data-vid={v.vid}
                    tabIndex={active ? 0 : -1}
                    ref={(el) => {
                      if (el) mountAtRef.current = Date.now()
                    }}
                    onLoad={() => {
                      // 冷加载耗时 = 网速代理:快网 ~0.2~0.3s、慢网 ~3s+,区分度很高
                      if (mountAtRef.current) markSlowNet(Date.now() - mountAtRef.current)
                      setReady((prev) => (prev.has(v.vid) ? prev : new Set(prev).add(v.vid)))
                    }}
                  />
                )}
                {/* 封面盖在播放器之上;闸门开过之后加 is-through → 点击穿透进去由播放器起播 */}
                {poster && !started && (
                  <img
                    className={`zx-vlog-poster${through ? ' is-through' : ''}${fading ? ' is-fading' : ''}`}
                    src={coverUrl(v)}
                    alt={epLabel(i, v.title)}
                    draggable={false}
                    decoding="async"
                    loading={active ? 'eager' : 'lazy'}
                    // 封面加载完 → 挂播放器暖机(挪到首屏大图之后,避免抢带宽)。
                    // 注意:SSR 出来的图往往在 hydration 前就已 complete,onLoad 不会再触发,
                    // 所以用 ref 回调补一次 complete 自查,否则播放器永远挂不上。
                    ref={(el) => {
                      if (el?.complete && el.naturalWidth > 0) markCoverLoaded(v.vid)
                    }}
                    onLoad={() => markCoverLoaded(v.vid)}
                    onError={() =>
                      setBroken((prev) => (prev.has(v.vid) ? prev : new Set(prev).add(v.vid)))
                    }
                  />
                )}
                {!showPlayer && !poster && (
                  <div className="zx-vlog-ghost">
                    <span className="zx-vlog-ghost-n">{i + 1}</span>
                    <span className="zx-vlog-ghost-t">{epLabel(i, v.title)}</span>
                  </div>
                )}
                {poster && !started && (
                  <span
                    className={`zx-vlog-poster-play${armed.has(v.vid) ? '' : ' is-busy'}${pulse.has(v.vid) ? ' is-pulse' : ''}`}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
                      <path d="M8 5.14v13.72L19 12 8 5.14Z" fill="currentColor" />
                    </svg>
                  </span>
                )}
                {diagOn && active && (
                  <span className="zx-vlog-diag" aria-hidden="true">
                    {`闸门${armed.has(v.vid) ? '开' : '关'}·信号${diag?.sig || '无'}·退场${
                      diag?.how || (retiring.has(v.vid) ? '淡出中' : '未发生')
                    }`}
                  </span>
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
