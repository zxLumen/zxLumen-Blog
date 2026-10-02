'use client'

/**
 * 生成一只生物:调 `/api/creature/generate` 拿 blueprint → 编译成 rig。
 *
 * **不做视觉自检**(已移除):那要额外一次读图调用(4~7s、质量还不稳),性价比低。
 * 改成用**本地启发式**给作品打分(纯函数、零延迟、零成本),见 `heuristicScore`。
 *
 * 失败语义很关键:只有「生成接口拿不到可用骨架」才置 `fallback`;限流(429)等
 * **临时错误**要保留上一次成功的骨架,不能把已经生成好的生物顶掉。
 */

import { useCallback, useRef, useState } from 'react'
import {
  normalizeBlueprint,
  compileBlueprint,
  heuristicScore,
  type CreatureBlueprint,
  type CompiledBlueprint,
  type ScoreBreakdown,
} from '@zx/shared/creature'

/** 一次生成的完整结果(用于「本次会话生成过什么」列表) */
export interface GenRecord {
  descr: string
  name: string
  archetype: string
  family: string
  parts: number
  matureDay: number
  score: ScoreBreakdown
  ms: number
  cached: boolean
  at: number
}

export interface GenState {
  loading: boolean
  phase: string
  /** 错误说明(临时错误也记,便于诊断) */
  error: string
  /** 是否在用**兜底骨架**(生成彻底失败)。限流等临时错误不会置这个 */
  fallback: boolean
  cached: boolean
  ms: number
  /** 当前展示生物的启发式评分 */
  score: ScoreBreakdown | null
}

const IDLE: GenState = {
  loading: false,
  phase: '',
  error: '',
  fallback: false,
  cached: false,
  ms: 0,
  score: null,
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const j = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    const err = new Error(j?.error || `HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return j
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
  const [history, setHistory] = useState<GenRecord[]>([])
  /** 单飞令牌:每次生成 +1,过期的响应直接丢弃 */
  const seq = useRef(0)
  /** 在途请求的取消器:新生成开始时取消旧的,避免多个慢请求堆在一起白烧配额 */
  const abortRef = useRef<AbortController | null>(null)

  const requestGen = useCallback(async (descr: string, signal: AbortSignal): Promise<GenOk> => {
    const r = await postJson<{ blueprint: CreatureBlueprint; cached?: boolean; ms?: number }>(
      '/api/creature/generate',
      { descr },
      signal,
    )
    const bp = normalizeBlueprint(r.blueprint)
    if (!bp) throw new Error('返回的骨架不可用')
    return { blueprint: bp, cached: !!r.cached, ms: r.ms ?? 0 }
  }, [])

  const generate = useCallback(
    async (descr: string) => {
      const my = ++seq.current
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      // 生成中保留上一次的分数,避免事实栏闪空
      setState((s) => ({ ...s, loading: true, phase: '正在按你的描述塑形…', error: '' }))

      let got: GenOk
      try {
        got = await requestGen(descr, ac.signal)
      } catch (e) {
        if (my !== seq.current) return null
        // 被新请求取消:什么都不做,交给新请求接管
        if (e instanceof DOMException && e.name === 'AbortError') return null
        const status = (e as { status?: number }).status
        // 限流是可恢复的临时错误 —— 保留上一次成功的生物,不要退回兜底
        const recoverable = status === 429 || status === 502 || status === 503
        setState((s) => ({
          ...s,
          loading: false,
          phase: '',
          error: e instanceof Error ? e.message : String(e),
          fallback: recoverable ? s.fallback : true,
          score: recoverable ? s.score : null,
        }))
        return null
      }
      if (my !== seq.current) return null

      // 先编译:打分要用编译后的完整 CreatureDna(带 plan/shape),
      // 直接传 blueprint 的裸 dna 会让 heuristicScore 在 dna.plan 上崩。
      const cc = compileBlueprint(got.blueprint)
      const score = heuristicScore(cc.dna, descr)
      setBlueprint(got.blueprint)
      setCompiled(cc)
      setState({
        ...IDLE,
        loading: false,
        cached: got.cached,
        ms: got.ms,
        score,
      })
      setHistory((h) =>
        [
          {
            descr,
            name: got.blueprint.dna.name,
            archetype: got.blueprint.dna.archetype,
            family: got.blueprint.motionCfg.family,
            parts: cc.rig.parts.length,
            matureDay: cc.matureDay,
            score,
            ms: got.ms,
            cached: got.cached,
            at: Date.now(),
          },
          ...h,
        ].slice(0, 12),
      )
      return got.blueprint
    },
    [requestGen],
  )

  return { blueprint, compiled, state, history, generate }
}
