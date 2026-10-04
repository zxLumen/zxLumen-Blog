'use client'

// 缩略图是运行时生成的 data URL,`next/image` 无法优化这类内联图,故用原生 <img>
/* eslint-disable @next/next/no-img-element */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  randomBatch,
  normalizeBlueprint,
  compileBlueprint,
  heuristicScore,
  fallbackDna,
  fitBradleyTerry,
  reconcilePair,
  rhoOf,
  type CreatureBlueprint,
  type CreatureDna,
  type ScoreBreakdown,
  type PairResult,
  type PairOutcome,
} from '@zx/shared/creature'
import { RigCreature } from './renderers/RigCreature'
import { renderToPng } from '@/lib/creature/render-png'

/**
 * 裁判验证台 —— 回答一个**可证伪**的问题:
 *
 *   「视觉模型(VLM)成对比较得到的审美排序,和人类排序的相关性,
 *     是否**明显高于**我们那套启发式打分(heuristicScore)与人类排序的相关性?」
 *
 * 判据(事先定好,不许事后挪动):
 *   令 ρ_heur = Spearman(heuristicTotal, 我的评分),ρ_vlm = Spearman(BT强度, 我的评分)
 *   - 若 ρ_vlm **明显** > ρ_heur(经验阈值见 `RHO_MARGIN`)→ 方向成立,值得工程化;
 *   - 若不明显甚至更差 → **证伪**,停止把精力投在「用 VLM 替代启发式」上。
 *
 * 方法学要点(踩过 / 想清楚了的):
 *  1. **成对而非打分**:语言/视觉模型直接给 0~100 会向中间塌缩,比较题稳定得多。
 *  2. **每个对双向各问一次**(A,B 与 B,A)。一致才采信;不一致判平局 —— 这是
 *     位置偏差(position bias)最直接的检测手段。
 *  3. **不做锚定**:锚点若取自这套评分,就是拿评分证明评分,循环论证。锚定留到
 *     方向验证通过、转生产单张打分时再谈。
 *  4. 人类侧用**同一批**样本的棒/还行/差,与两条机器分数做秩相关 —— 三方都用秩,
 *     尺度无关。
 */

const BATCH_N = 18
const CONCURRENCY = 6
/** 成对裁判的并发(比生成慢,也给服务端限流留余地) */
const JUDGE_CONCURRENCY = 4

const RATINGS = ['棒', '还行', '差'] as const
type Rating = (typeof RATINGS)[number]
const RATING_SCORE: Record<Rating, number> = { 棒: 2, 还行: 1, 差: 0 }

/**
 * 「明显更高」的经验阈值。ρ 差 0.15 大概对应「一个可感知的量级」;
 * 定小了会把噪声当信号,定大了永远证不了。**这个数要事先定死**,否则就是挪门柱。
 */
const RHO_MARGIN = 0.15

interface Item {
  id: number
  descr: string
  blueprint: CreatureBlueprint | null
  score: ScoreBreakdown | null
  dna: CreatureDna | null
  rig: ReturnType<typeof compileBlueprint>['rig'] | null
  matureDay: number
  ms: number
  error: string
  wait: string
  rating: Rating | null
  /** 渲染出的 PNG data URL;出图失败时为 '' */
  png: string
}

/** 一对的裁决记录 */
interface PairLog {
  /** 无序对键 `min:max` */
  key: string
  a: number
  b: number
  /** 正向 A,B 的裁决 */
  ab: PairOutcome | null
  /** 反向 B,A 的裁决(注意语义:这是「把 b 放前面」问的,解析后仍要换算回原始 a/b) */
  ba: PairOutcome | null
  /** 双向是否一致(不一致记平局,并标注) */
  disagreed: boolean
  /** 合并进 BT 的最终结果 */
  outcome: PairOutcome
  reason: string
  ms: number
}

export function JudgeLab() {
  const [seedText, setSeedText] = useState('20261004')
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState('')
  const [pairs, setPairs] = useState<PairLog[]>([])
  const [judging, setJudging] = useState(false)
  const seq = useRef(0)

  const done = items.filter((i) => i.blueprint).length
  const judged = pairs.length

  /* ============================ 1. 生成 + 出图 ============================ */

  const run = useCallback(async (seed: number) => {
    const my = ++seq.current
    const batch = randomBatch(BATCH_N, seed)
    setRunning(true)
    setPairs([])
    setStage('生成中…')
    setItems(
      batch.items.map((it) => ({
        id: it.id,
        descr: it.descr,
        blueprint: null,
        score: null,
        dna: null,
        rig: null,
        matureDay: 34,
        ms: 0,
        error: '',
        wait: '',
        rating: null,
        png: '',
      })),
    )

    let cursor = 0
    const note = (id: number, msg: string) =>
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, wait: msg } : p)))

    const worker = async () => {
      for (;;) {
        const idx = cursor++
        if (idx >= batch.items.length || my !== seq.current) return
        const it = batch.items[idx]!
        try {
          const j = await postWithRetry(it.descr, (msg) => my === seq.current && note(it.id, msg))
          if (my !== seq.current) return
          const r = j.jobId ? await pollJob(j.jobId) : j
          if (my !== seq.current) return
          const bp = r.blueprint
          if (!bp) throw new Error('未返回骨架')
          const norm = normalizeBlueprint(bp)
          if (!norm) throw new Error('骨架不可用')
          const cc = compileBlueprint(norm)
          const score = heuristicScore(cc.dna, it.descr, {
            parts: norm.parts,
            motionFamily: norm.motionCfg?.family,
            span: norm.span,
            motionRules: Object.values(norm.motionCfg?.rules ?? {}),
          })
          setItems((prev) =>
            prev.map((p) =>
              p.id === it.id
                ? {
                    ...p,
                    blueprint: norm,
                    score,
                    dna: cc.dna,
                    rig: cc.rig,
                    matureDay: cc.matureDay,
                    ms: r.ms ?? 0,
                    wait: '',
                  }
                : p,
            ),
          )
        } catch (e) {
          if (my !== seq.current) return
          const msg = e instanceof Error ? e.message : String(e)
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, error: msg, wait: '' } : p)))
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.items.length) }, worker))
    if (my !== seq.current) return

    // 出图:把所有成功样本渲染成 PNG(串行,浏览器端不需要并发)
    setStage('出图中…')
    const rendered = await Promise.all(
      batch.items.map(async (it) => {
        const cur = await new Promise<Item | undefined>((res) =>
          setItems((prev) => {
            res(prev.find((p) => p.id === it.id))
            return prev
          }),
        )
        if (!cur?.dna || !cur.rig) return null
        try {
          const png = await renderToPng(cur.dna, cur.rig, cur.matureDay)
          return { id: it.id, png }
        } catch {
          return { id: it.id, png: '' }
        }
      }),
    )
    if (my !== seq.current) return
    const byId = new Map(rendered.filter(Boolean).map((r) => [r!.id, r!.png]))
    setItems((prev) => prev.map((p) => ({ ...p, png: byId.get(p.id) ?? '' })))
    setStage('')
    setRunning(false)
  }, [])

  const start = () => void run(Number(seedText) || Date.now() >>> 0)

  const rate = useCallback((id: number, r: Rating) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, rating: r } : p)))
  }, [])

  /* ============================ 2. 成对裁判 ============================ */

  /** 可参与裁判的样本:已出图 */
  const judgeable = useMemo(
    () => items.filter((i) => i.png && i.blueprint),
    [items],
  )

  /**
   * 只对「我已评分」的样本做裁判,且**只比较评分不同的对**。
   * 为什么:同一档的两个样本(都「棒」)谁更好,人类侧没有信息,拉进来只会稀释信号、
   * 还平白多烧一半调用。裁判该集中回答「我明确分出了高低的两只,VLM 同不同意」。
   */
  const ratedItems = useMemo(() => judgeable.filter((i) => i.rating), [judgeable])

  const allPairs = useMemo(() => {
    const out: { a: Item; b: Item }[] = []
    for (let i = 0; i < ratedItems.length; i++) {
      for (let j = i + 1; j < ratedItems.length; j++) {
        const a = ratedItems[i]!
        const b = ratedItems[j]!
        if (RATING_SCORE[a.rating!] === RATING_SCORE[b.rating!]) continue
        out.push({ a, b })
      }
    }
    return out
  }, [ratedItems])

  const judgeAll = useCallback(async () => {
    if (!allPairs.length) return
    setJudging(true)
    setPairs([])
    let cursor = 0
    const logs: PairLog[] = []
    const worker = async () => {
      for (;;) {
        const idx = cursor++
        if (idx >= allPairs.length) return
        const { a, b } = allPairs[idx]!
        const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`
        setStage(`裁判中… ${logs.length + 1}/${allPairs.length}`)
        try {
          // 双向各问一次:正向 (A,B),反向 (B,A)。
          // ⚠ `reconcilePair` 的第二参数是**反向提问的原始裁决**(第一张=b),
          //   它内部会自己翻面;这里**不要**再手动翻一次,否则负负得正、测不出位置偏差。
          const fwd = await askJudge(a.png, b.png)
          const rev = await askJudge(b.png, a.png)
          const ab: PairOutcome | null = toOutcome(fwd.verdict)
          const ba: PairOutcome | null = toOutcome(rev.verdict)
          const rec = reconcilePair(String(a.id), String(b.id), ab ?? 'tie', ba ?? 'tie')
          logs.push({
            key,
            a: a.id,
            b: b.id,
            ab,
            ba,
            disagreed: rec.disagreed,
            outcome: rec.outcome,
            reason: fwd.reason || rev.reason,
            ms: fwd.ms + rev.ms,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          logs.push({
            key,
            a: a.id,
            b: b.id,
            ab: null,
            ba: null,
            disagreed: false,
            outcome: 'tie',
            reason: `调用失败:${msg}`,
            ms: 0,
          })
        }
        setPairs([...logs])
      }
    }
    await Promise.all(Array.from({ length: Math.min(JUDGE_CONCURRENCY, allPairs.length) }, worker))
    setStage('')
    setJudging(false)
  }, [allPairs])

  /* ============================ 3. 三方相关 ============================ */

  const stats = useMemo(() => {
    const scoreById = new Map(items.map((i) => [i.id, i]))
    // 只用「已评分 且 有裁判结果」的样本来算,三方都齐才公平
    const involved = new Set<number>()
    for (const p of pairs) {
      involved.add(p.a)
      involved.add(p.b)
    }
    const sample = [...involved]
      .map((id) => scoreById.get(id))
      .filter((i): i is Item => !!i && !!i.score)

    if (sample.length < 3) return null

    // BT 强度(用双向合并后的 outcome)
    const btPairs: PairResult[] = pairs.map((p) => ({
      a: String(p.a),
      b: String(p.b),
      outcome: p.outcome,
    }))
    const bt = fitBradleyTerry(
      sample.map((s) => String(s.id)),
      btPairs,
    )
    const btOf = (id: number) => bt.theta[String(id)] ?? 0

    const human = sample.map((s) => RATING_SCORE[s.rating!])
    const heur = sample.map((s) => s.score!.total)
    const vlm = sample.map((s) => btOf(s.id))

    const rhoHeur = rhoOf(heur, human)
    const rhoVlm = rhoOf(vlm, human)
    const rhoCross = rhoOf(heur, vlm)
    const disagreeRate = pairs.length ? pairs.filter((p) => p.disagreed).length / pairs.length : 0
    const calls = pairs.length * 2
    const spent = pairs.reduce((n, p) => n + (p.ms / 1000) * 0.00025, 0)

    let verdict = ''
    if (rhoHeur !== null && rhoVlm !== null) {
      const delta = rhoVlm - rhoHeur
      if (delta >= RHO_MARGIN) verdict = `方向成立:ρ_vlm 比 ρ_heur 高 ${delta.toFixed(2)}(≥${RHO_MARGIN})`
      else if (delta <= -RHO_MARGIN) verdict = `反向:ρ_vlm 反而低 ${(-delta).toFixed(2)},证伪`
      else verdict = `不明显(Δ=${delta.toFixed(2)},阈值 ${RHO_MARGIN})→ 不足以支撑工程化`
    }

    // 按 BT 强度排序,和人类排序并排看
    const ranked = [...sample].sort((a, b) => btOf(b.id) - btOf(a.id))
    return { sample, bt, ranked, human, heur, vlm, rhoHeur, rhoVlm, rhoCross, disagreeRate, calls, spent, verdict }
  }, [items, pairs])

  /* ============================ 渲染 ============================ */

  return (
    <div className="judge-wrap">
      <header className="judge-head">
        <h1>裁判验证台</h1>
        <p className="judge-lead">
          验证「视觉模型成对比较」能否成为比启发式打分更贴近人类审美的排序器。
          <b>可证伪</b>:ρ_vlm 不比 ρ_heur 明显更高,就说明这条路不值得工程化。
        </p>
        <div className="judge-controls">
          <label>
            seed
            <input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && start()}
            />
          </label>
          <button onClick={start} disabled={running}>
            {running ? stage || '运行中…' : `生成一批(${BATCH_N} 只)`}
          </button>
          <button
            className="is-primary"
            onClick={() => void judgeAll()}
            disabled={judging || !allPairs.length || running}
            title={allPairs.length ? `将发起 ${allPairs.length * 2} 次裁判调用` : '先评分,且至少有评分不同的样本'}
          >
            {judging
              ? stage || '裁判中…'
              : `开始成对裁判(${allPairs.length} 对 / ${allPairs.length * 2} 次调用)`}
          </button>
        </div>
        <div className="judge-progress">
          生成 {done}/{BATCH_N}
          {items.some((i) => i.error) && ` · 失败 ${items.filter((i) => i.error).length}`}
          {' · '}已评分 {items.filter((i) => i.rating).length}
          {' · '}已裁判 {judged}/{allPairs.length}
        </div>
      </header>

      {/* 样本网格:点一下循环切「棒/还行/差」 */}
      <section className="judge-grid">
        {items.map((i) => (
          <div key={i.id} className={`judge-card${i.error ? ' is-err' : ''}`}>
            <div className="judge-thumb">
              {i.png ? (
                <img src={i.png} alt={`#${i.id}`} />
              ) : i.blueprint ? (
                <RigCreature dna={i.dna ?? fallbackDna(i.descr)} rig={i.rig!} box={160} fixedDay={i.matureDay} matureDay={i.matureDay} />
              ) : (
                <div className="judge-ph">{i.wait || i.error || '待生成'}</div>
              )}
            </div>
            <div className="judge-meta">
              <span className="judge-id">#{i.id}</span>
              {i.score && <span className="judge-score">{i.score.total.toFixed(0)}</span>}
            </div>
            <div className="judge-descr" title={i.descr}>
              {i.descr}
            </div>
            <div className="judge-rate">
              {RATINGS.map((r) => (
                <button
                  key={r}
                  className={i.rating === r ? 'is-on' : ''}
                  onClick={() => rate(i.id, r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 结果 */}
      {stats && (
        <section className="judge-result">
          <h2>三方相关(n={stats.sample.length})</h2>
          <table className="judge-rho">
            <thead>
              <tr>
                <th>对照</th>
                <th>Spearman ρ</th>
                <th>含义</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>启发式 ↔ 人</td>
                <td className="num">{fmtRho(stats.rhoHeur)}</td>
                <td>现状:我们的打分有多贴近人</td>
              </tr>
              <tr className="is-key">
                <td>VLM-BT ↔ 人</td>
                <td className="num">{fmtRho(stats.rhoVlm)}</td>
                <td>假设:模型成对比较能不能更贴近</td>
              </tr>
              <tr>
                <td>启发式 ↔ VLM-BT</td>
                <td className="num">{fmtRho(stats.rhoCross)}</td>
                <td>两者是不是在量不同的东西</td>
              </tr>
            </tbody>
          </table>
          <p className={`judge-verdict${stats.verdict.startsWith('方向成立') ? ' is-ok' : ''}`}>
            {stats.verdict}
          </p>
          <p className="judge-cost">
            裁判调用 <b>{stats.calls}</b> 次 · 双向不一致率{' '}
            <b>{(stats.disagreeRate * 100).toFixed(0)}%</b>(不一致判平局)· 估算花费 $
            {stats.spent.toFixed(4)}
          </p>

          <h2>排序对照(BT 强度降序)</h2>
          <table className="judge-rank">
            <thead>
              <tr>
                <th>#</th>
                <th>样本</th>
                <th>人</th>
                <th>启发式</th>
                <th>BT θ</th>
              </tr>
            </thead>
            <tbody>
              {stats.ranked.map((s, k) => (
                <tr key={s.id}>
                  <td>{k + 1}</td>
                  <td className="judge-rank-d">
                    <img src={s.png} alt="" />
                    <span>#{s.id}</span>
                  </td>
                  <td>{s.rating}</td>
                  <td className="num">{s.score!.total.toFixed(0)}</td>
                  <td className="num">{stats.bt.theta[String(s.id)]?.toFixed(2) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {pairs.length > 0 && (
            <details className="judge-log">
              <summary>逐对裁决({pairs.length})</summary>
              <ul>
                {pairs.map((p) => (
                  <li key={p.key} className={p.disagreed ? 'is-disagree' : ''}>
                    <b>
                      #{p.a} vs #{p.b}
                    </b>{' '}
                    → {p.outcome === 'a' ? `#${p.a}` : p.outcome === 'b' ? `#${p.b}` : '平局'}
                    {p.disagreed && <em>(双向不一致)</em>}
                    <span className="judge-log-reason">{p.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {!items.length && (
        <p className="judge-hint">点「生成一批」:随机描述生成 → 浏览器出图 → 你评分 → 成对裁判。</p>
      )}
    </div>
  )
}

function fmtRho(v: number | null): string {
  return v === null ? '—(样本不足)' : v.toFixed(3)
}

/* ============================ 出图 ============================ */

// 出图统一走 `@/lib/creature/render-png`(裁判台与「创建生物」共用),见那里的注释。

/* ============================ 裁判调用 ============================ */

interface JudgeResp {
  verdict: 'A' | 'B' | '平局' | null
  reason: string
  ms: number
  finishReason?: string
  error?: string
}

/**
 * 问一次「第一张 vs 第二张」。**注意入参顺序就是图在 prompt 里的顺序** ——
 * 调用方负责双向反着再问一次,并自行换算回原始语义。
 */
async function askJudge(firstPng: string, secondPng: string): Promise<JudgeResp> {
  const res = await fetch('/api/lab/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: firstPng, b: secondPng }),
  })
  const j = (await res.json().catch(() => ({}))) as JudgeResp
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
  return j
}

/** 路由返回的「第一张 / 第二张」(A/B)换算成 BT 的 outcome 语义(a/b/tie) */
function toOutcome(v: JudgeResp['verdict']): PairOutcome | null {
  if (v === 'A') return 'a'
  if (v === 'B') return 'b'
  if (v === '平局') return 'tie'
  return null
}

/* ============================ 生成调用(复用 generate 的路由) ============================ */

type GenResp = {
  blueprint?: CreatureBlueprint
  ms?: number
  error?: string
  state?: string
  jobId?: string
  retryable?: boolean
}

const RETRY_DEADLINE_MS = 120_000

async function postWithRetry(descr: string, onWait: (msg: string) => void): Promise<GenResp> {
  const t0 = Date.now()
  let attempt = 0
  for (;;) {
    attempt++
    const res = await fetch('/api/creature/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descr }),
    })
    const j = (await res.json().catch(() => ({}))) as GenResp
    if (res.ok) return j
    const permanent = j.retryable === false
    const retryable = (res.status === 429 && !permanent) || res.status >= 500
    if (!retryable || Date.now() - t0 > RETRY_DEADLINE_MS) throw new Error(j.error || `HTTP ${res.status}`)
    const wait = Math.min(8000, 1000 * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.6)
    onWait(`${res.status === 429 ? (j.error ?? '太频繁') : `异常 ${res.status}`},${(wait / 1000).toFixed(1)}s 后重试`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

async function pollJob(jobId: string): Promise<{ blueprint?: CreatureBlueprint; ms?: number }> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500))
    const res = await fetch(`/api/creature/generate?jobId=${encodeURIComponent(jobId)}`)
    if (!res.ok) throw new Error('排队记录已失效')
    const j = (await res.json()) as { state: string; blueprint?: CreatureBlueprint; ms?: number; error?: string }
    if (j.state === 'done') return { blueprint: j.blueprint, ms: j.ms }
    if (j.state === 'error' || j.state === 'cancelled' || j.state === 'gone') throw new Error(j.error || '生成失败')
  }
}
