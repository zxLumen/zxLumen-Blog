'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * 指针拖拽排序(鼠标 + 触屏通吃,零依赖)。
 *
 * 为什么不用浏览器原生的 HTML5 drag & drop:
 *  - 触屏上根本不触发,只能靠 ↑↓ 兜底 —— 访客端在手机上没法用;
 *  - dragstart → dragover → drop 是连续几个任务,而 setState 要等重渲染才提交,
 *    在 dragover 里读 state 拿到的还是旧值(通常是 null),整条拖拽会静默失效。
 * 指针事件没有这个问题:pointerdown/move/up 在同一串任务里,ref 同步可读。
 * 实现沿用 ChatWidget 浮标拖动那套(见 ChatWidget.tsx 的 onDragStart/Move/End)。
 *
 * 两个消费方:
 *  - 访客应用栏 AppDock:整块可拖(按住就拖),受分组约束,顺序存 localStorage;
 *  - admin「应用」面板:只有 ⠿ 把手能拖(整行可拖会毁掉行内输入框选字),
 *    拖到别的组会由 adjustDrop 夹到组边界(保证提交不出交错顺序)。
 */

/** 落点:插到 targetId 的上方(before)还是下方 */
export interface DropTarget {
  targetId: string
  before: boolean
}

export interface DragReorderOptions {
  /** 参与排序的 id 顺序(不含被禁用的项) */
  ids: string[]
  /** 落序:'y' 竖排(桌面应用栏 / admin 列表)、'x' 横排(窄屏底部横条) */
  axis: 'x' | 'y'
  /**
   * 按 id 取分组名。给了就**只允许同组内排序** —— 访客端用 admin 定的分组,
   * 这样分隔线永远待在有意义的位置;admin 自己改分组,所以不传。
   */
  groupOf?: (id: string) => string
  /**
   * 落点规整:把「命中哪个条目的哪一侧」修正成实际落点(缺省原样返回)。
   *
   * 在 computeDrop 里**只跑一次**,落点提示与最终提交共用同一个结果 ——
   * 两边各算一遍必然对不上(指示线画一处、东西落另一处),这比算错更糟:
   * 用户会以为没生效,反复拖。
   *
   * admin 用它把跨组落点夹到目标组边界,见 snapDropToGroup。
   */
  adjustDrop?: (ids: readonly string[], from: number, hit: DropTarget) => DropTarget
  /** 落手后拿到新顺序 */
  onCommit: (ids: string[]) => void
  /** 拖到边缘时自动滚动的盒子;不传就不自动滚 */
  getScrollBox?: () => HTMLElement | null
  /** 盒子本身不滚(长页面,滚的是 window)时置 true */
  scrollWindow?: boolean
  /** 位移阈值(px),超过才算拖拽。触屏手指按下有 3~5px 抖动,别设太小 */
  threshold?: number
  /** 整体禁用(少于两项、加载中、保存中) */
  disabled?: boolean
}

export interface DragReorder {
  /** 正在拖动的 id(给样式用) */
  dragId: string | null
  /** 当前落点提示(给样式用) */
  drop: DropTarget | null
  /** 测命中用的元素注册回调,挂到「整块」上(与拖动把手可以不是同一个元素) */
  registerItem: (id: string) => (el: HTMLElement | null) => void
  /** 拖动把手的事件,挂到可发起拖拽的那个元素上 */
  handleProps: (id: string) => {
    onPointerDown: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerUp: (e: ReactPointerEvent) => void
    onPointerCancel: () => void
    /** 挂在可点击元素上,吞掉拖拽后浏览器补发的那次 click */
    onClickCapture: (e: React.MouseEvent) => void
  }
}

/** 拖到离边缘多近开始自动滚动(px) */
const EDGE = 44

export function useDragReorder(opts: DragReorderOptions): DragReorder {
  const { ids, axis, groupOf, onCommit, getScrollBox, scrollWindow, disabled } = opts
  const threshold = opts.threshold ?? (typeof window !== 'undefined' && 'ontouchstart' in window ? 8 : 4)

  /**
   * 配置存一份 ref 当唯一真相。拖拽期间读的是「按下去那一刻」的顺序和回调,
   * 不受中途重渲染影响 —— 这正是 HTML5 那版翻车的地方。
   */
  const cfg = useRef({ ids, groupOf, onCommit, axis, getScrollBox, scrollWindow, adjustDrop: opts.adjustDrop })
  cfg.current = { ids, groupOf, onCommit, axis, getScrollBox, scrollWindow, adjustDrop: opts.adjustDrop }

  /** 被拖动的 id / 起点 / 是否已越过阈值 —— 同上,ref 同步可读 */
  const drag = useRef<{ id: string; pointerId: number; sx: number; sy: number; moved: boolean } | null>(null)
  /** 吞掉落手后浏览器补发的那次 click */
  const suppressClick = useRef(false)
  const els = useRef(new Map<string, HTMLElement>())

  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const dropRef = useRef<DropTarget | null>(null)

  const setDropSafe = useCallback((d: DropTarget | null) => {
    dropRef.current = d
    setDrop(d)
  }, [])

  const stopAutoScroll = useCallback(() => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current)
      raf.current = null
    }
  }, [])

  const endDrag = useCallback(
    (commit: boolean) => {
      const d = drag.current
      /**
       * 落点必须**先取出来再清**。下面 setDropSafe(null) 会把 dropRef 置空,
       * 放到它之后读就永远是 null → 落手什么都不提交,表现为"拖得出但放不下"。
       * 跟之前 HTML5 那版"在 dragover 里读还没提交的 state"是同一类错。
       */
      const at = dropRef.current
      drag.current = null
      stopAutoScroll()
      lastPt.current = null
      setDragId(null)
      setDropSafe(null)
      if (!d) return
      if (!d.moved) return
      // 越过阈值才算拖过:把浏览器随后补发的那次 click 吃掉,免得拖完误开链接
      suppressClick.current = true
      if (!commit) return
      const { ids: cur, groupOf: g, onCommit: commitFn } = cfg.current
      const from = cur.indexOf(d.id)
      const to = at ? cur.indexOf(at.targetId) : -1
      if (from < 0 || to < 0 || from === to) return
      // 组约束:只允许同组内
      if (g && g(d.id) !== g(at!.targetId)) return
      const next = [...cur]
      const [moved] = next.splice(from, 1)
      /**
       * 移除源项后,目标的新下标要往前挪一位。
       * 漏了这一步,向下拖会插到目标「后面」去 —— 只写 splice(before ? to : to+1)
       * 的话向下拖到中间行必错,是这段逻辑最容易踩的坑。
       */
      const target = to - (from < to ? 1 : 0)
      next.splice(at!.before ? target : target + 1, 0, moved)
      commitFn(next)
    },
    [setDropSafe, stopAutoScroll],
  )

  /** 按指针位置算落点:命中哪个条目、插它上面还是下面;异组不算命中 */
  const computeDrop = useCallback((clientX: number, clientY: number): DropTarget | null => {
    const d = drag.current
    if (!d) return null
    const { ids: cur, groupOf: g, axis: ax, adjustDrop: adj } = cfg.current
    if (!cur.includes(d.id)) return null
    const from = cur.indexOf(d.id)
    const fromGroup = g?.(d.id) ?? ''
    for (const id of cur) {
      if (id === d.id) continue
      if (g && (g(id) ?? '') !== fromGroup) continue
      const el = els.current.get(id)
      if (!el) continue
      const r = el.getBoundingClientRect()
      let hit: DropTarget | null = null
      if (ax === 'y') {
        if (clientY < r.top || clientY > r.bottom) continue
        hit = { targetId: id, before: clientY < r.top + r.height / 2 }
      }
      if (!hit) {
        if (clientX < r.left || clientX > r.right) continue
        hit = { targetId: id, before: clientX < r.left + r.width / 2 }
      }
      // 规整只在这里做一次:存进 dropRef 的既是画指示线用的、也是 endDrag 提交用的
      return adj ? adj(cur, from, hit) : hit
    }
    return null
  }, [])

  /* ---------- 边缘自动滚动 ----------
     Dock 桌面是 overflow-y:auto、窄屏是 overflow-x:auto 的固定盒子,
     而条目上要 touch-action:none 才能让「按住就拖」在手机上成立 ——
     代价就是手指横扫不再滚这个盒子。所以拖拽时必须自己滚,否则远处的条目够不着。 */
  const raf = useRef<number | null>(null)
  const lastPt = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (drag.current?.moved !== true) return
    const tick = () => {
      raf.current = requestAnimationFrame(tick)
      const pt = lastPt.current
      const box = cfg.current.getScrollBox?.()
      if (!pt || !box) return
      const r = box.getBoundingClientRect()
      let dx = 0
      let dy = 0
      if (cfg.current.axis === 'y') {
        if (pt.y < r.top + EDGE) dy = -Math.max(1, Math.ceil((r.top + EDGE - pt.y) / 4))
        else if (pt.y > r.bottom - EDGE) dy = Math.max(1, Math.ceil((pt.y - (r.bottom - EDGE)) / 4))
      } else {
        if (pt.x < r.left + EDGE) dx = -Math.max(1, Math.ceil((r.left + EDGE - pt.x) / 4))
        else if (pt.x > r.right - EDGE) dx = Math.max(1, Math.ceil((pt.x - (r.right - EDGE)) / 4))
      }
      if (!dx && !dy) return
      if (cfg.current.scrollWindow) window.scrollBy(dx, dy)
      else {
        box.scrollLeft += dx
        box.scrollTop += dy
      }
      // 滚完命中位置变了,重算落点(否则指示线会停在旧位置)
      setDropSafe(computeDrop(pt.x, pt.y))
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
    }
  }, [dragId, computeDrop, setDropSafe])

  useEffect(() => stopAutoScroll, [stopAutoScroll])

  const registerItem = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(id, el)
      else els.current.delete(id)
    },
    [],
  )

  const onPointerDown = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      if (disabled) return
      // 只认主键 / 单指
      if (e.pointerType === 'mouse' && e.button !== 0) return
      drag.current = { id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false }
      lastPt.current = { x: e.clientX, y: e.clientY }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* 某些浏览器对已释放的指针会抛,忽略 */
      }
    },
    [disabled],
  )

  const onPointerMove = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      const d = drag.current
      if (!d || d.id !== id || d.pointerId !== e.pointerId) return
      lastPt.current = { x: e.clientX, y: e.clientY }
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < threshold) return
        d.moved = true
        setDragId(id)
      }
      // 越过阈值才算拖动,之前不 preventDefault:点一下还是正常点击/跳转
      if (e.cancelable) e.preventDefault()
      setDropSafe(computeDrop(e.clientX, e.clientY))
    },
    [computeDrop, setDropSafe, threshold],
  )

  const onPointerUp = useCallback(
    (id: string) => (e: ReactPointerEvent) => {
      const d = drag.current
      if (!d || d.id !== id || d.pointerId !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      endDrag(true)
    },
    [endDrag],
  )

  const onPointerCancel = useCallback(() => endDrag(false), [endDrag])

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // 兜底:万一这次没补发 click(比如手拖出了元素),别把用户下一次正常点击也吃掉
  useEffect(() => {
    if (!suppressClick.current) return
    const t = setTimeout(() => {
      suppressClick.current = false
    }, 300)
    return () => clearTimeout(t)
  }, [dragId])

  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: onPointerDown(id),
      onPointerMove: onPointerMove(id),
      onPointerUp: onPointerUp(id),
      onPointerCancel,
      onClickCapture,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture],
  )

  return { dragId, drop, registerItem, handleProps }
}

/**
 * 把访客存下的 id 顺序套到当前列表上,并对账 admin 的增删:
 *  - admin 删掉的 id:从本地顺序里剔掉;
 *  - admin 新加的 id:插回它在 admin 列表里的相对位置(跟在 admin 里的前一个邻居后面),
 *    而不是一律塞到末尾 —— 否则站长加了新应用,老访客看到的却是在最末尾。
 */
export function applySavedOrder<T extends { id: string }>(list: T[], saved: readonly string[] | null): T[] {
  if (!saved || saved.length === 0) return list
  const byId = new Map(list.map((a) => [a.id, a]))
  const out: T[] = []
  const used = new Set<string>()
  for (const id of saved) {
    const item = byId.get(id)
    if (item && !used.has(id)) {
      out.push(item)
      used.add(id)
    }
  }
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (used.has(item.id)) continue
    // admin 列表里它前面最近的、已进 out 的条目
    let prev: T | undefined
    for (let k = i - 1; k >= 0; k--) {
      if (used.has(list[k].id)) {
        prev = list[k]
        break
      }
    }
    const at = prev ? out.findIndex((x) => x.id === prev!.id) + 1 : out.length
    out.splice(at, 0, item)
    used.add(item.id)
  }
  return out
}

/**
 * 稳定按组归拢:保持组内相对顺序,组间按各组首个成员的首次出现顺序排列。
 *
 * 这是「同组必连续」的唯一实现。修的是**分组之前就存下的交错访客顺序** ——
 * 访客拖拽时的组约束(useDragReorder 的 groupOf)只拦得住新的跨组拖动,
 * 救不了早已写进 localStorage 的 `["github","rag","resume"]`;admin 侧则由
 * snapDropToGroup 从源头保证不提交交错顺序。两侧最终都落到这条不变量上。
 *
 * 纯函数、幂等:对已经连续的顺序原样返回(只换了个数组),所以访客每次渲染
 * 都直接套一遍即可,不必把归拢结果写回 localStorage。
 */
export function groupContiguous<T extends { group?: string }>(list: readonly T[]): T[] {
  const buckets = new Map<string, T[]>()
  for (const item of list) {
    const k = item.group ?? ''
    const bucket = buckets.get(k)
    if (bucket) bucket.push(item)
    else buckets.set(k, [item])
  }
  // 只有一个组时必然已经连续,省掉一次数组分配(绝大多数情况)
  if (buckets.size <= 1) return [...list]
  return [...buckets.values()].flat()
}

/**
 * 跨组拖拽时把落点夹到目标组的边界(不落中间),给 useDragReorder 的 adjustDrop 用。
 *
 * 为什么 admin 侧必须管这件事:admin 拖出来的顺序就是**所有访客的默认顺序**。
 * 一旦交出 `[github, rag, resume]` 这种交错(两项同组被别的组劈开),
 * 每个访客都会看到多余的分隔线,而访客侧的 ↺ 只重置访客顺序、
 * 回到 admin 那个交错默认 —— 救不了。
 *
 * 规则:落点邻居所在的那一段连续组,合法插入位只有它的**两端**;落点切进段内
 * 就取较近的一侧(平手取「之后」,跟住向前拖的方向)。整张表都同组时无从拆起,
 * 原样放行(否则没分组的应用会被莫名其妙地限制到表头表尾)。
 */
export function snapDropToGroup(
  ids: readonly string[],
  from: number,
  hit: DropTarget,
  groupOf: (id: string) => string,
): DropTarget {
  const rest = ids.filter((_, i) => i !== from)
  if (!rest.length) return hit
  const at = rest.indexOf(hit.targetId)
  if (at < 0) return hit
  // 摘掉源项后再定位,所以这里直接就是「插到 rest[insert] 之前」
  let insert = at + (hit.before ? 0 : 1)
  // 落点邻居所在的组;插到末尾时看最后一条
  const probe = Math.min(insert, rest.length - 1)
  const g = groupOf(rest[probe]) ?? ''
  let s = probe
  let e = probe
  while (s > 0 && (groupOf(rest[s - 1]) ?? '') === g) s--
  while (e < rest.length - 1 && (groupOf(rest[e + 1]) ?? '') === g) e++
  /**
   * 全表同组**且自己就在这个组里**才放行(组内自由排序,别把没分组的应用
   * 限制到表头表尾)。注意不能只看 rest:摘掉源项后剩下的一段可能恰好同组,而
   * 拖进来的是**别的组**的应用 —— 那样落进去照样会把这一段劈开,必须夹到边上。
   */
  if (s === 0 && e === rest.length - 1 && (groupOf(ids[from]) ?? '') === g) return hit
  // 合法插入位只有 s 与 e+1;落点切进段内(不含两端)才需要夹
  if (insert > s && insert <= e) insert = insert - s < e + 1 - insert ? s : e + 1
  if (insert < rest.length) return { targetId: rest[insert], before: true }
  return { targetId: rest[rest.length - 1], before: false }
}
