'use client'

/**
 * 生成一只生物:调 `/api/creature/generate` 拿 blueprint → 编译成 rig;
 * 再用 `/api/creature/judge` 做一次视觉自检,低分就把问题带回重试一次。
 *
 * 为什么自检放在**客户端**:截图要拿到真实渲染结果,浏览器里 `SVG → canvas` 现成;
 * 服务器端还要再跑一个无头浏览器,成本高得多。
 *
 * 自检失败(模型不支持读图 / 网络错 / 未配图模型)**不算生成失败** —— 只是没有分数,
 * 骨架照样用。真正的兜底只在「生成接口拿不到可用骨架」时触发。
 */

import { useCallback, useRef, useState } from 'react'
import {
  normalizeBlueprint,
  compileBlueprint,
  type CreatureBlueprint,
  type CompiledBlueprint,
} from '@zx/shared/creature'

export interface JudgeResult {
  score: number
  looksLike: string
  issues: string[]
  advice: string
}

export interface GenState {
  loading: boolean
  /** 当前阶段文案,给用户看 */
  phase: string
  /** 出错的说明(已兜底时也保留,便于诊断) */
  error: string
  /** 是否在用**兜底骨架**(生成彻底失败)。自检失败不会置这个 */
  fallback: boolean
  cached: boolean
  ms: number
  judge: JudgeResult | null
  /** 试了几次(含重试) */
  attempts: number
}

const IDLE: GenState = {
  loading: false,
  phase: '',
  error: '',
  fallback: false,
  cached: false,
  ms: 0,
  judge: null,
  attempts: 0,
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const j = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`)
  return j
}

/** SVG 元素截图成 PNG data URL(深色底,避免透明背景让模型误判) */
export async function snapshotSvg(svg: SVGSVGElement, size = 320): Promise<string> {
  const xml = new XMLSerializer().serializeToString(svg)
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('SVG 转图片失败'))
      im.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无 canvas 上下文')
    ctx.fillStyle = '#0e1420'
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(img, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 等这只 SVG「真的画出来了」再截图。
 *
 * 直接把 SVG **克隆进一张临时 <img> 是不可靠的** —— 序列化发生在 `useCreatureLoop`
 * 的 rAF 写 `transform` 之前时,拿到的是「有 path 但全叠在原点」或干脆空的中间态,
 * 于是自检永远判 0 分、白白触发重试。
 *
 * 所以这里等两件事:① 至少渲染过一帧(双 rAF);② 用 canvas 采样,确认非背景像素足够多。
 * 最多等 ~1.2s,超时就把当前结果交出去(自检本来就允许失败)。
 */
export async function snapshotSvgWhenReady(
  getSvg: () => SVGSVGElement | null,
  size = 320,
): Promise<string | null> {
  const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)))

  for (let attempt = 0; attempt < 12; attempt++) {
    await raf()
    await raf()
    const svg = getSvg()
    if (!svg) {
      await new Promise((r) => setTimeout(r, 100))
      continue
    }
    // 至少有路径,且不是「刚挂上还没布局」
    const paths = svg.querySelectorAll('path')
    if (paths.length === 0) {
      await new Promise((r) => setTimeout(r, 100))
      continue
    }
    try {
      const data = await snapshotSvg(svg, size)
      const ink = await inkRatio(data)
      if (ink > 0.01) return data
    } catch {
      /* 下一轮再试 */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

/** 采样一张 data URL 图的「非背景像素」占比(用于判断是否真的画出了东西) */
async function inkRatio(dataUrl: string, size = 320): Promise<number> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('采样失败'))
    im.src = dataUrl
  })
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) return 0
  ctx.drawImage(img, 0, 0, size, size)
  const px = ctx.getImageData(0, 0, size, size).data
  let ink = 0
  for (let i = 0; i < px.length; i += 4) {
    if (Math.abs(px[i] - 14) + Math.abs(px[i + 1] - 20) + Math.abs(px[i + 2] - 32) > 30) ink++
  }
  return ink / (size * size)
}

interface GenOk {
  blueprint: CreatureBlueprint
  cached: boolean
  ms: number
}

export function useCreatureGen() {
  const [blueprint, setBlueprint] = useState<CreatureBlueprint | null>(null)
  const [compiled, setCompiled] = useState<CompiledBlueprint | null>(null)
  const [state, setState] = useState<GenState>(IDLE)
  /** 单飞令牌:每次生成 +1,过期的响应直接丢弃,避免旧请求把新状态覆盖回去 */
  const seq = useRef(0)

  const requestGen = useCallback(async (descr: string, retryHint?: string): Promise<GenOk> => {
    const r = await postJson<{ blueprint: CreatureBlueprint; cached?: boolean; ms?: number }>(
      '/api/creature/generate',
      { descr, retryHint },
    )
    const bp = normalizeBlueprint(r.blueprint)
    if (!bp) throw new Error('返回的骨架不可用')
    return { blueprint: bp, cached: !!r.cached, ms: r.ms ?? 0 }
  }, [])

  /**
   * 生成 + 自检一个描述。
   *
   * `getSvg` 用来拿当前渲染出来的 SVG 去截图。整条链路**只有一个令牌**:生成成功就
   * 立刻把骨架交给 UI(即使后面自检/重试慢,也不影响显示的是一只真生物)。
   */
  const generateWithCheck = useCallback(
    async (descr: string, getSvg: () => SVGSVGElement | null) => {
      const my = ++seq.current
      setState({ ...IDLE, loading: true, phase: '正在按你的描述塑形…' })

      // ---- 1) 生成 ----
      let first: GenOk
      try {
        first = await requestGen(descr)
      } catch (e) {
        if (my !== seq.current) return null
        setState({
          ...IDLE,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          fallback: true,
        })
        return null
      }
      if (my !== seq.current) return null

      setBlueprint(first.blueprint)
      setCompiled(compileBlueprint(first.blueprint))
      setState({
        ...IDLE,
        loading: false,
        cached: first.cached,
        ms: first.ms,
        attempts: 1,
      })

      // ---- 2) 自检(失败不影响可用性) ----
      const image = await snapshotSvgWhenReady(getSvg)
      if (my !== seq.current) return first.blueprint
      // 截不出图(还没画出来)就跳过自检,别拿空白图去误判 0 分
      if (!image) return first.blueprint

      setState((s) => ({ ...s, phase: '正在用视觉模型自检…' }))
      let judge: JudgeResult | null = null
      try {
        judge = await postJson<JudgeResult>('/api/creature/judge', { descr, image })
      } catch {
        if (my === seq.current) setState((s) => ({ ...s, phase: '' }))
        return first.blueprint
      }
      if (my !== seq.current) return first.blueprint
      setState((s) => ({ ...s, phase: '', judge }))

      if (judge.score >= 6) return first.blueprint

      // ---- 3) 低分:带问题重试一次 ----
      const hint = [judge.advice, ...judge.issues].filter(Boolean).join(';').slice(0, 120)
      if (!hint) return first.blueprint

      setState((s) => ({ ...s, loading: true, phase: '不太像,正在重捏一次…' }))
      let second: GenOk
      try {
        second = await requestGen(descr, hint)
      } catch {
        if (my === seq.current) setState((s) => ({ ...s, loading: false, phase: '' }))
        return first.blueprint
      }
      if (my !== seq.current) return first.blueprint

      setBlueprint(second.blueprint)
      setCompiled(compileBlueprint(second.blueprint))
      setState({
        ...IDLE,
        loading: false,
        cached: second.cached,
        ms: second.ms,
        attempts: 2,
        judge,
      })
      return second.blueprint
    },
    [requestGen],
  )

  return { blueprint, compiled, state, generateWithCheck }
}
