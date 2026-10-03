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
 *
 * **每个实例 = 一个互不干扰的槽位。** 实测一次生成 17s~142s,页面上一排格子
 * 各跑各的:各自的 loading / compiled / history,谁也不取消谁。所以取消逻辑只
 * 防「同一个槽位被连点两次」,不承担跨槽位的去重。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * 阶段提示。**这是按「已等待时长」推进的演示脚本,不是上游真实进度** ——
 * `/api/creature/generate` 是一次性非流式调用,中间没有任何可上报的进度点。
 * 阈值按实测分布铺开(12 部件约 17s / 25 部件约 142s,中位 20.6s),
 * 于是快请求只会看到前几档,慢请求才会一路走到「在等上游」。
 */
const STAGES: readonly { at: number; text: string }[] = [
  { at: 0, text: '正在读你的描述…' },
  { at: 2_500, text: '在拆结构:定身体架构与部件层级' },
  { at: 9_000, text: '在长零件:躯干 / 头 / 附肢 / 尾…' },
  { at: 22_000, text: '在上色:主色 / 辅色 / 辉光…' },
  { at: 45_000, text: '在编排动效:摆动 / 漂浮 / 自转…' },
  { at: 80_000, text: '在编译成 rig 并本地打分…' },
]

/** 超过最后一档还没到 —— 明确说「慢」,别让进度条假装还在前进 */
const OVERDUE_TEXT = '上游这会儿有点慢,还在等…'

/** 进度条封顶 0.96:到 1 就成了「卡住了」,不如留一点余量 */
const PROGRESS_CAP = 0.96

/** 等待计时器的分辨率:250ms。再细纯属浪费渲染 */
const TICK_MS = 250

/**
 * 上游耗时的**滚动中位数**,跨所有槽位共享。
 *
 * 预估时间用它而不是平均值:平均值会被 142s 那种长尾拽走,中位数稳(实测中位 20.6s)。
 * 挂在 `globalThis` 上,免得 HMR 把样本清零、每次改代码都退回初值。
 * 初值 22s 就近取实测中位。
 */
const LATENCY_G = '__zxCreatureLatency'
const LATENCY_MAX = 12
const LATENCY_SEED = 22_000

function latencySamples(): number[] {
  const g = globalThis as unknown as { [LATENCY_G]?: number[] }
  return (g[LATENCY_G] ??= [LATENCY_SEED])
}

/** 当前预估总耗时(ms) */
export function estimateLatencyMs(): number {
  const s = [...latencySamples()].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? LATENCY_SEED
}

function recordLatency(ms: number) {
  if (!(ms > 0)) return
  latencySamples().push(ms)
  if (latencySamples().length > LATENCY_MAX) latencySamples().shift()
}

/** 等待期的展示信息 */
export interface GenWait {
  /** 已经等了多久(ms) */
  waitedMs: number
  /** 当前阶段文案 */
  text: string
  /** 阶段序号(0 起) */
  stage: number
  /** 阶段总数 */
  stages: number
  /** 预估总耗时(ms) */
  estimateMs: number
  /** 预计还要等(ms);已超时为 0 */
  etaMs: number
  /** 进度 0~0.96 */
  progress: number
  /** 已经超过预估 —— 上游偏慢 */
  overdue: boolean
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

export interface GenOptions {
  /** 生成成功时把记录交给父组件 —— 各槽位自己留一份,页面再汇总成「本次生成过什么」 */
  onRecord?: (r: GenRecord) => void
}

export function useCreatureGen(opts: GenOptions = {}) {
  const { onRecord } = opts
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
  /** 本次生成的起始时刻:算「已经等了多久」 */
  const startedAt = useRef(0)
  /** 等待时长(ms);由下面的 ticker 推进 —— 一次生成动辄一两分钟,不刷新就没有「在等」的实感 */
  const [waitedMs, setWaitedMs] = useState(0)

  /** 只在生成中跑表 */
  useEffect(() => {
    if (!state.loading) return
    const t = setInterval(() => setWaitedMs(Math.max(0, Date.now() - startedAt.current)), TICK_MS)
    return () => clearInterval(t)
  }, [state.loading])

  /** 阶段 / 预估 / 进度条 */
  const wait = useMemo<GenWait | null>(() => {
    if (!state.loading) return null
    let stage = 0
    for (let i = 0; i < STAGES.length; i++) {
      if (waitedMs >= STAGES[i].at) stage = i
    }
    const estimateMs = estimateLatencyMs()
    const overdue = waitedMs > estimateMs
    return {
      waitedMs,
      text: overdue && stage === STAGES.length - 1 ? OVERDUE_TEXT : STAGES[stage].text,
      stage,
      stages: STAGES.length,
      estimateMs,
      etaMs: Math.max(0, estimateMs - waitedMs),
      progress: Math.min(PROGRESS_CAP, waitedMs / estimateMs),
      overdue,
    }
  }, [state.loading, waitedMs])

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
      startedAt.current = Date.now()
      setWaitedMs(0)
      // phase 只留给「排队」用(那是服务端真话);生成中的阶段文案由 wait.text 给
      setState((s) => ({ ...s, loading: true, phase: '', error: '', queuePosition: 0, queueEtaMs: 0 }))

      let got: GenOk
      try {
        got = await requestGen(descr, ac.signal, (position, etaMs) => {
          setState((s) => ({
            ...s,
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
      // 真实耗时喂给滚动中位数,下一次预估就准一点
      recordLatency(got.ms)
      const rec: GenRecord = {
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
      }
      setHistory((h) => [rec, ...h].slice(0, 12))
      onRecord?.(rec)
      return got.blueprint
    },
    [requestGen, dropJob, onRecord],
  )

  return { blueprint, compiled, state, history, generate, wait, cancelJob: dropJob }
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