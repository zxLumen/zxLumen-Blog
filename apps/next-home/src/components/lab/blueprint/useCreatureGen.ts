'use client'

/**
 * 生成一只生物:调 `/api/creature/generate` 拿 blueprint → 编译成 rig。
 *
 * **不做视觉自检**(已移除):那要额外一次读图调用(4~7s、质量还不稳),性价比低。
 * 改成用**本地启发式**给作品打分(纯函数、零延迟、零成本),见 `heuristicScore`。
 *
 * **排队**:服务端并发满时会返回 202 + jobId,这里改成轮询 `GET ?jobId=`,
 * 期间把「前面还有 N 只 / 约 XXs」报给 UI。常见路径(有空位)仍是一次 POST 直接拿结果。
 *
 * 失败语义很关键:只有「生成接口拿不到可用骨架」才置 `fallback`;限流(429)等
 * **临时错误**要保留上一次成功的骨架,不能把已经生成好的生物顶掉。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** 排队中:前面还有几只 */
  queuePosition: number
  /** 排队中:预计还要等多久(ms) */
  queueEtaMs: number
  /** 今天这个 cookie 还能生成几只 */
  remainingToday: number
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
  queuePosition: 0,
  queueEtaMs: 0,
  remainingToday: -1,
  error: '',
  fallback: false,
  cached: false,
  ms: 0,
  score: null,
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
  /** 当前排队中的 jobId:新生成 / 卸载时通知服务端把它摘掉(不烧 token) */
  const jobRef = useRef<string>('')

  /** 取消排队中的 job(还在等就不该白跑一次模型) */
  const dropJob = useCallback((jobId: string) => {
    if (!jobId) return
    void fetch('/api/creature/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', jobId }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  /**
   * 有空位 → 一次 POST 直接拿结果(200);
   * 排队中 → 202 {jobId, position, etaMs},轮询到 done / error 为止。
   */
  const requestGen = useCallback(
    async (descr: string, signal: AbortSignal, onQueue: (p: number, etaMs: number) => void): Promise<GenOk> => {
      const res = await fetch('/api/creature/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descr }),
        signal,
      })
      const j = (await res.json().catch(() => ({}))) as {
        state?: string
        jobId?: string
        position?: number
        etaMs?: number
        blueprint?: CreatureBlueprint
        ms?: number
        remainingToday?: number
        error?: string
      }
      if (!res.ok) {
        const err = new Error(j?.error || `HTTP ${res.status}`) as Error & { status?: number }
        err.status = res.status
        throw err
      }
      if (typeof j.remainingToday === 'number') setState((s) => ({ ...s, remainingToday: j.remainingToday! }))
      // 直接出结果(常见路径)
      if (j.blueprint) {
        const bp = normalizeBlueprint(j.blueprint)
        if (!bp) throw new Error('返回的骨架不可用')
        return { blueprint: bp, cached: false, ms: j.ms ?? 0 }
      }
      // 排队:轮询
      const jobId = j.jobId ?? ''
      jobRef.current = jobId
      onQueue(j.position ?? 1, j.etaMs ?? 45_000)
      return await pollJob(jobId, signal, onQueue)
    },
    [],
  )

  // 卸载时:中止在途 fetch,并把排队中的 job 摘掉(别白烧一次模型)
  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (jobRef.current) {
        const jid = jobRef.current
        jobRef.current = ''
        void fetch('/api/creature/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', jobId: jid }),
          keepalive: true,
        }).catch(() => {})
      }
    },
    [],
  )

  const generate = useCallback(
    async (descr: string) => {
      const my = ++seq.current
      abortRef.current?.abort()
      dropJob(jobRef.current)
      jobRef.current = ''
      const ac = new AbortController()
      abortRef.current = ac
      // 生成中保留上一次的分数,避免事实栏闪空
      setState((s) => ({ ...s, loading: true, phase: '正在按你的描述塑形…', error: '', queuePosition: 0, queueEtaMs: 0 }))

      let got: GenOk
      try {
        got = await requestGen(descr, ac.signal, (position, etaMs) => {
          setState((s) => ({
            ...s,
            phase: position > 0 ? `排队中 · 前面还有 ${position} 只 · 约 ${Math.round(etaMs / 1000)}s` : '正在按你的描述塑形…',
            queuePosition: position,
            queueEtaMs: etaMs,
          }))
        })
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
          queuePosition: 0,
          queueEtaMs: 0,
          error: e instanceof Error ? e.message : String(e),
          fallback: recoverable ? s.fallback : true,
          score: recoverable ? s.score : null,
        }))
        return null
      } finally {
        if (my === seq.current) jobRef.current = ''
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
    [requestGen, dropJob],
  )

  return { blueprint, compiled, state, history, generate, cancelJob: dropJob }
}

/** 轮询排队中的 job;每 1.5s 一次,直到 done / error / 被取消 */
async function pollJob(
  jobId: string,
  signal: AbortSignal,
  onQueue: (position: number, etaMs: number) => void,
): Promise<GenOk> {
  const POLL_MS = 1_500
  for (;;) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(POLL_MS, signal)
    const res = await fetch(`/api/creature/generate?jobId=${encodeURIComponent(jobId)}`, { signal })
    // 任务记录过期(TTL 10 分钟)或服务重启:让调用方按可恢复错误处理
    if (!res.ok) {
      const err = new Error('排队记录已失效,请重新生成') as Error & { status?: number }
      err.status = 503
      throw err
    }
    const j = (await res.json()) as {
      state: string
      position?: number
      etaMs?: number
      blueprint?: CreatureBlueprint
      ms?: number
      error?: string
      status?: number
    }
    if (j.state === 'queued') {
      onQueue(j.position ?? 1, j.etaMs ?? 0)
      continue
    }
    if (j.state === 'running') {
      onQueue(0, 0)
      continue
    }
    if (j.state === 'done' && j.blueprint) {
      const bp = normalizeBlueprint(j.blueprint)
      if (!bp) throw new Error('返回的骨架不可用')
      onQueue(0, 0)
      return { blueprint: bp, cached: false, ms: j.ms ?? 0 }
    }
    // error / cancelled / gone
    const err = new Error(j.error || '生成失败') as Error & { status?: number }
    err.status = j.state === 'cancelled' ? 499 : (j.status ?? 503)
    throw err
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}