'use client'

/**
 * Lumen 生灵 · 打分校验台 —— 「这批分数到底可不可信」。
 *
 * 上一页(`/lab/species`)能看出模型每次生成的东西不一样,但那只回答了**多样性**。
 * 这里回答的是另一个问题:**`heuristicScore` 给的分,是有意义的信号还是在吃噪声?**
 *
 * 只把 30 只按分排开等于自己读自己 —— 排名里没有一个外部参照。所以页面给两个
 * 参照,而且都是**能证伪**的:
 *
 * 1. **同原型三档对照(外部参照 = 描述丰富度)**
 *    随机描述按三连一组出题,同一组 `sparse / medium / rich` **共用同一个原型**,
 *    只改描述的丰富度 —— 于是「丰富度」成了唯一自变量,「动物本身好不好看」这个
 *    混淆变量被控制住了。**若三档均分不呈上升,评分就没在认描述质量。**
 * 2. **机器排名 vs 我的评价(外部参照 = 人)**
 *    每只给你三个按钮(棒 / 还行 / 差)。评完直接看一致度,以及偏差最大的那几只 ——
 *    机器和人分歧最大的样本,往往就是评分公式的 bug 线索。
 *
 * 并发自己控(默认 8 路),不靠服务端队列:一批 30 只会把服务端的 12 个槽位灌满,
 * 后面十几只排队超过 90s 就被丢了,白跑。
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  randomBatch,
  DENSITY_LABEL,
  WEIGHTS,
  heuristicScore,
  compileBlueprint,
  normalizeBlueprint,
  type CreatureBlueprint,
  type CreatureDna,
  type Density,
  type RandomItem,
  type ScoreBreakdown,
} from '@zx/shared/creature'
import { RigCreature } from './renderers/RigCreature'
import { fallbackDna } from '@zx/shared/creature'
import { speciesFor } from './species'

const SCORE_LABELS: Record<string, string> = {
  palette: '配色',
  traits: '特质',
  motion: '动效',
  narrative: '成长',
  match: '关键词',
  structure: '结构',
  fidelity: '落实',
}
/** `narrative` / `match` 权重已降,排前面会让人误以为它们最重要 */
const SCORE_KEYS = ['fidelity', 'structure', 'palette', 'traits', 'motion', 'narrative', 'match'] as const
type ScoreKey = (typeof SCORE_KEYS)[number]

/** 默认一批的规模 */
const BATCH_N = 30
/** 客户端并发。数多了会把服务端 12 个槽位灌满,后面排队超 90s 被丢 */
const CONCURRENCY = 8

/** 我的人工评价:转成可比的名次(棒 > 还行 > 差) */
const RATINGS = ['棒', '还行', '差'] as const
type Rating = (typeof RATINGS)[number]
const RATING_SCORE: Record<Rating, number> = { 棒: 2, 还行: 1, 差: 0 }

interface Item {
  id: number
  descr: string
  density: Density
  /** 组号:同组三档共用一个原型 */
  group: number
  blueprint: CreatureBlueprint | null
  score: ScoreBreakdown | null
  /** 编译后的完整 DNA(渲染与评分用)。
   *  ⚠ 不能直接用 `blueprint.dna` —— 那是编译**前**的残缺形态,缺 v/shape/plan,
   *  渲染和 heuristicScore 都得吃编译后的这份。 */
  dna: CreatureDna | null
  /** 编译后的产物(渲染与条带用);失败时回落到默认产物 */
  rig: ReturnType<typeof compileBlueprint>['rig'] | null
  matureDay: number
  ms: number
  error: string
  /** 瞬时状态(排队 / 限流退避 / 重试),与 error 分开:它不是失败 */
  wait: string
  rating: Rating | null
}

const DENSITY_ORDER: Density[] = ['sparse', 'medium', 'rich']

export function ScoreLab() {
  const [seedText, setSeedText] = useState('20261004')
  const [items, setItems] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [sortKey, setSortKey] = useState<ScoreKey | 'total'>('total')
  const [picked, setPicked] = useState<number | null>(null)
  const seq = useRef(0)

  /** 一批跑完的统计(进度 / 花费) */
  const done = items.filter((i) => i.blueprint).length
  const failed = items.filter((i) => i.error).length
  const spent = items.reduce((n, i) => n + (i.blueprint ? costOf(i.ms) : 0), 0)

  const run = useCallback(
    async (seed: number) => {
      const my = ++seq.current
      const batch = randomBatch(BATCH_N, seed)
      setRunning(true)
      setPicked(null)
      setItems(
        batch.items.map((it) => ({
          id: it.id,
          descr: it.descr,
          density: it.density,
          group: Math.floor((it.id - 1) / DENSITY_ORDER.length),
          blueprint: null,
          score: null,
          dna: null,
          rig: null,
          matureDay: 34,
          ms: 0,
          error: '',
          wait: '',
          rating: null,
        })),
      )

      // 客户端限流的 worker 池:一条一条领,领完就退
      let cursor = 0
      const worker = async () => {
        for (;;) {
          const idx = cursor++
          if (idx >= batch.items.length) return
          if (my !== seq.current) return
          const it = batch.items[idx]!
          try {
            const j = await postWithRetry(
              it.descr,
              (msg) => {
                if (my === seq.current) note(it.id, msg)
              },
            )
            if (my !== seq.current) return
            if (j.jobId) {
              const r = await pollJob(j.jobId)
              if (my !== seq.current) return
              applyOne(it, r)
            } else {
              applyOne(it, j)
            }
          } catch (e) {
            if (my !== seq.current) return
            const msg = e instanceof Error ? e.message : String(e)
            setItems((prev) =>
              prev.map((p) => (p.id === it.id ? { ...p, error: msg, wait: '' } : p)),
            )
          }
        }
      }

      /** 瞬时状态(排队/限流退避/重试),不是错误 */
      function note(id: number, msg: string) {
        setItems((prev) => prev.map((p) => (p.id === id ? { ...p, wait: msg } : p)))
      }

      /** 把一条结果落到 state;**先编译再打分**(裸 dna 没有 plan/shape,heuristicScore 会崩) */
      function applyOne(
        it: RandomItem,
        r: { blueprint?: CreatureBlueprint; ms?: number },
      ) {
        const bp = r.blueprint
        if (!bp) return
        const norm = normalizeBlueprint(bp)
        if (!norm) throw new Error('骨架不可用')
        const cc = compileBlueprint(norm)
        const score = heuristicScore(cc.dna, it.descr, {
          parts: cc.rig.parts,
          motionFamily: norm.motionCfg?.family,
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
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.items.length) }, worker))
      if (my === seq.current) setRunning(false)
    },
    [],
  )

  const start = () => void run(Number(seedText) || Date.now() >>> 0)
  const reroll = () => {
    const s = (Number(seedText) || 1) + 1
    setSeedText(String(s))
    void run(s)
  }

  const rate = useCallback((id: number, r: Rating) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, rating: r } : p)))
  }, [])

  /* --------------------------- 排序 --------------------------- */

  const ranked = useMemo(() => {
    const ok = items.filter((i) => i.score)
    const val = (i: Item) => (sortKey === 'total' ? i.score!.total : i.score![sortKey])
    return [...ok].sort((a, b) => val(b) - val(a))
  }, [items, sortKey])

  const rankOfId = useMemo(() => new Map(ranked.map((r, k) => [r.id, k + 1])), [ranked])

  /* ------------------------- 校验指标 ------------------------- */

  /** 参照一:描述丰富度 → 总分。同原型三档,只看组内差值,消掉「动物本身」的干扰 */
  const densityStats = useMemo(() => {
    const rows = DENSITY_ORDER.map((d) => {
      const xs = items.filter((i) => i.density === d && i.score)
      return {
        density: d,
        n: xs.length,
        avg: xs.length ? xs.reduce((n, i) => n + i.score!.total, 0) / xs.length : 0,
      }
    })
    // rich 相对**同组** sparse 的分差 —— 这才是干净的自变量对照
    const lifts: Record<ScoreKey, { sum: number; n: number }> = {
      palette: { sum: 0, n: 0 },
      traits: { sum: 0, n: 0 },
      motion: { sum: 0, n: 0 },
      narrative: { sum: 0, n: 0 },
      match: { sum: 0, n: 0 },
      structure: { sum: 0, n: 0 },
      fidelity: { sum: 0, n: 0 },
    }
    let lift = 0
    let liftN = 0
    for (const it of items) {
      if (it.density !== 'rich' || !it.score) continue
      const base = items.find((p) => p.group === it.group && p.density === 'sparse')?.score
      if (!base) continue
      lift += it.score.total - base.total
      liftN++
      for (const k of SCORE_KEYS) {
        lifts[k].sum += it.score[k] - base[k]
        lifts[k].n++
      }
    }
    return {
      rows,
      lift: liftN ? lift / liftN : 0,
      liftN,
      perDim: SCORE_KEYS.map((k) => ({
        key: k,
        label: SCORE_LABELS[k],
        weight: WEIGHTS[k],
        lift: lifts[k].n ? (lifts[k].sum / lifts[k].n) * 100 : 0,
      })),
    }
  }, [items])

  /** 参照二:机器排名 vs 我的评价 */
  const agree = useMemo(() => {
    const rated = ranked.filter((i) => i.rating)
    if (rated.length < 2) return null
    // 人工名次:同档内按 id 排,档间按评价
    const byRating = [...rated].sort(
      (a, b) => RATING_SCORE[b.rating!] - RATING_SCORE[a.rating!] || a.id - b.id,
    )
    const myRank = new Map(byRating.map((r, k) => [r.id, k + 1]))
    // 只看「我打了分」的这些:在子集内重算机器名次,才可比
    const machine = new Map(
      [...rated].sort((a, b) => b.score!.total - a.score!.total).map((r, k) => [r.id, k + 1]),
    )
    let same = 0
    let near = 0
    let far = 0
    const pairs = rated.map((i) => {
      const d = Math.abs(machine.get(i.id)! - myRank.get(i.id)!)
      if (d <= 2) same++
      else if (d <= 6) near++
      else far++
      return { item: i, d }
    })
    return {
      n: rated.length,
      same,
      near,
      far,
      /** 分歧最大的几只:机器公式的 bug 线索 */
      worst: pairs.sort((a, b) => b.d - a.d).slice(0, 3),
    }
  }, [ranked])

  const totals = useMemo(() => {
    const xs = items.filter((i) => i.score).map((i) => i.score!.total)
    if (!xs.length) return null
    return {
      avg: xs.reduce((a, b) => a + b, 0) / xs.length,
      min: Math.min(...xs),
      max: Math.max(...xs),
      /** 极差太小 = 所有样本挤在一起,排名没信息量 */
      spread: Math.max(...xs) - Math.min(...xs),
    }
  }, [items])

  const active = items.find((i) => i.id === picked) ?? null

  return (
    <div className="cl-root sc-root">
      <header className="cl-head">
        <h1>
          Lumen 生灵 · 打分校验台<span className="cl-en">Luminari</span>
        </h1>
        <p>
          随机出 <b>{BATCH_N}</b> 条描述生成一批生物,按<b>启发式评分</b>排名,并给出两个**能证伪**的参照 ——
          同原型三档的丰富度对照、以及机器排名与你的评价是否一致。
          <b>落实</b>与<b>结构</b>是这一版新增的两维:前者问「描述里点名的有没有真长在身上」,
          后者问「搭得认不认真」(部件数、角色分工、主体占比)。权重见{' '}
          <code>
            {SCORE_KEYS.map((k) => `${SCORE_LABELS[k]} ${WEIGHTS[k]}`).join(' / ')}
          </code>
          。
        </p>
        <div className="sc-bar">
          <label>
            种子
            <input value={seedText} onChange={(e) => setSeedText(e.target.value)} inputMode="numeric" />
          </label>
          <button type="button" className="sc-go" onClick={start} disabled={running}>
            {running ? `生成中… ${done}/${BATCH_N}` : items.length ? '按这个种子重跑' : '生成一批'}
          </button>
          <button type="button" className="sc-go sc-go-ghost" onClick={reroll} disabled={running}>
            换一批(种子 +1)
          </button>
          <span className="sc-bar-note">
            并发 {CONCURRENCY} 路 · 同种子必出同一批题,调权重时能复跑对比
          </span>
        </div>
      </header>

      {items.length > 0 && (
        <>
          <section className="sc-sum">
            <div className="sc-sum-row">
              <span>
                已完成 <b>{done}</b>/{BATCH_N}
              </span>
              {failed > 0 && <span className="sc-bad">失败 {failed}</span>}
              <span>平均 {totals ? totals.avg.toFixed(1) : '—'}</span>
              <span>区间 {totals ? `${totals.min.toFixed(0)}~${totals.max.toFixed(0)}` : '—'}</span>
              <span className={totals && totals.spread < 12 ? 'sc-bad' : ''}>
                极差 {totals ? totals.spread.toFixed(0) : '—'}
                {totals && totals.spread < 12 ? '(挤在一起了,排名没信息量)' : ''}
              </span>
              {spent > 0 && <span>约 ${spent.toFixed(3)}</span>}
            </div>

            {/* 参照一:丰富度 → 总分 */}
            <div className="sc-ref">
              <h2>参照一 · 同原型三档(控制「动物本身」这个混淆变量)</h2>
              <div className="sc-ref-row">
                {densityStats.rows.map((r) => (
                  <span key={r.density} className="sc-ref-cell">
                    <em>{DENSITY_LABEL[r.density]}</em>
                    <b>{r.avg.toFixed(1)}</b>
                    <i>n={r.n}</i>
                  </span>
                ))}
                <span
                  className="sc-ref-cell sc-ref-lift"
                  data-ok={densityStats.lift > 3 ? '1' : '0'}
                  title="同一原型的 rich 描述减去 sparse 描述的均分差。正数说明评分认得出描述质量。"
                >
                  <em>丰富度带来的提升</em>
                  <b>
                    {densityStats.lift >= 0 ? '+' : ''}
                    {densityStats.lift.toFixed(1)}
                  </b>
                  <i>n={densityStats.liftN} 组</i>
                </span>
              </div>
              {densityStats.liftN > 0 && (
                <>
                  <div className="sc-lift-dims">
                    {densityStats.perDim.map((d) => (
                      <span key={d.key} className="sc-lift-dim" data-tauto={d.key === 'match' ? '1' : '0'}>
                        <em>
                          {d.label}
                          <i>{d.weight}</i>
                        </em>
                        <b>
                          {d.lift >= 0 ? '+' : ''}
                          {d.lift.toFixed(0)}
                        </b>
                      </span>
                    ))}
                  </div>
                  <p className="sc-hint">
                    单位:分(满分 100)× 权重前。带 * 的{' '}
                    <code>match</code>{' '}
                    <b>天然偏向上</b> —— 它数的是描述里的关键词有多少被命中,而 rich 描述
                    提供的关键词更多;另外它的原型项 cap 随描述变长(同原型下反而略降)。
                    所以别拿它当证据,<b>看 palette / traits / motion / narrative 这四维才对</b>。
                  </p>
                </>
              )}
              {densityStats.liftN > 0 && densityStats.lift <= 3 && (
                <p className="sc-warn">
                  ⚠ 提升只有 {densityStats.lift.toFixed(1)} 分 —— <b>评分基本没在认描述丰富度</b>,
                  多半是权重里 narrative/match 被生成端的自由度盖住了,或 rubric 该加一条「描述信息量」。
                </p>
              )}
            </div>

            {/* 参照二:机器排名 vs 我的评价 */}
            <div className="sc-ref">
              <h2>参照二 · 机器排名 vs 我的评价</h2>
              {!agree ? (
                <p className="sc-warn">还没评价 —— 在下面的排名列表里给每只点「棒 / 还行 / 差」。</p>
              ) : (
                <>
                  <div className="sc-ref-row">
                    <span className="sc-ref-cell" data-ok="1">
                      <em>一致(±2 名)</em>
                      <b>{agree.same}</b>
                      <i>共 {agree.n}</i>
                    </span>
                    <span className="sc-ref-cell">
                      <em>略偏(±6)</em>
                      <b>{agree.near}</b>
                    </span>
                    <span className="sc-ref-cell sc-ref-lift" data-ok={agree.far <= agree.n / 5 ? '1' : '0'}>
                      <em>相反(&gt;6)</em>
                      <b>{agree.far}</b>
                    </span>
                  </div>
                  {agree.far > 0 && (
                    <p className="sc-warn">
                      分歧最大:{agree.worst.map((w) => `${w.item.blueprint!.dna.name}(差 ${w.d} 名)`).join('、')}
                      —— 这些是评分公式最该先看的样本。
                    </p>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="sc-list-wrap">
            <div className="sc-sort">
              排序
              <button
                type="button"
                className={sortKey === 'total' ? 'is-on' : ''}
                onClick={() => setSortKey('total')}
              >
                总分
              </button>
              {SCORE_KEYS.map((k) => (
                <button key={k} type="button" className={sortKey === k ? 'is-on' : ''} onClick={() => setSortKey(k)}>
                  {SCORE_LABELS[k]}
                  <i>{WEIGHTS[k]}</i>
                </button>
              ))}
            </div>

            <div className="sc-list">
              {items.map((i) => {
                const it = ranked.find((r) => r.id === i.id)
                const rank = rankOfId.get(i.id)
                const vv = i.score ? (sortKey === 'total' ? i.score.total : i.score[sortKey]) : 0
                // 档位按实测分布重定。第一版 55/75 而分布是 48.9~67.4,75 从没到过;
                // 加权调整后分布变成 61.7~81.8,故取 ~1/3 与 ~2/3 分位。
                const verdict = i.score
                  ? i.score.total >= 78
                    ? 'ok'
                    : i.score.total >= 68
                      ? 'mid'
                      : 'bad'
                  : undefined
                return (
                  <div
                    key={i.id}
                    className="sc-row"
                    data-status={
                      i.blueprint ? 'done' : i.error ? 'error' : i.wait || running ? 'loading' : 'idle'
                    }
                    data-density={i.density}
                    data-picked={picked === i.id ? '1' : '0'}
                  >
                    <span className="sc-rank">{rank ?? '—'}</span>
                    <button
                      type="button"
                      className="sc-thumb"
                      onClick={() => setPicked(picked === i.id ? null : i.id)}
                      title="点开看大图与成长条带"
                    >
                      <RigCreature
                        dna={i.dna ?? fallbackDna(i.descr)}
                        rig={i.rig ?? speciesFor(i.descr)}
                        box={78}
                        fixedDay={18}
                        matureDay={i.matureDay}
                      />
                    </button>
                    <div className="sc-info">
                      <div className="sc-line1">
                        <span className="sc-name">
                          {i.blueprint?.dna.name ?? (i.error ? '失败' : i.wait ? '重试中' : '…')}
                        </span>
                        <span className="sc-dens" title="描述丰富度(同组三档共用一个原型)">
                          {DENSITY_LABEL[i.density]}
                        </span>
                        <span className="sc-chip" data-score={verdict}>
                          {i.score ? vv.toFixed(0) : ''}
                        </span>
                        {i.blueprint && <span className="sc-mini">{i.ms > 0 ? `${(i.ms / 1000).toFixed(0)}s` : ''}</span>}
                      </div>
                      <div className="sc-descr" title={i.descr}>
                        {i.wait || i.descr}
                      </div>
                      <div className="sc-dims">
                        {SCORE_KEYS.map((k) => (
                          <span
                            key={k}
                            className="sc-dim"
                            title={`${SCORE_LABELS[k]} ${i.score ? i.score[k].toFixed(2) : '—'}（权重 ${WEIGHTS[k]}）`}
                          >
                            <i>
                              <b style={{ width: `${Math.round(((i.score?.[k] ?? 0) as number) * 100)}%` }} />
                            </i>
                          </span>
                        ))}
                        {i.score?.fidelityNotes?.length ? (
                          <span className="sc-fid" title="落实度在比什么:描述里点名的特征,有没有真的长在身上">
                            {i.score.fidelityNotes.join(' ')}
                          </span>
                        ) : null}
                        <span className="sc-my">
                          {RATINGS.map((r) => (
                            <button
                              key={r}
                              type="button"
                              className={i.rating === r ? 'is-on' : ''}
                              onClick={() => rate(i.id, r)}
                            >
                              {r}
                            </button>
                          ))}
                        </span>
                      </div>
                      {it && sortKey !== 'total' && <span className="sc-sortval">按{SCORE_LABELS[sortKey]}排第 {rank}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {active && active.blueprint && active.rig && (
            <section className="sc-detail">
              <h2>
                {active.blueprint.dna.name}
                <button type="button" className="sc-x" onClick={() => setPicked(null)}>
                  收起
                </button>
              </h2>
              <div className="sc-detail-stage">
                <RigCreature dna={active.dna!} rig={active.rig} box={300} matureDay={active.matureDay} />
              </div>
              <div className="sc-detail-strip">
                {[0, 2, 4, 7, 10, 14, 19, 25, 34, 45, 60].map((d) => (
                  <figure key={d}>
                    <RigCreature
                      dna={active.dna!}
                      rig={active.rig!}
                      box={92}
                      fixedDay={d}
                      matureDay={active.matureDay}
                    />
                    <figcaption>D{d}</figcaption>
                  </figure>
                ))}
              </div>
              <p className="sc-detail-descr">{active.descr}</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}

/** 粗略折算花费,只用来看「这一批大概烧了多少」 */
function costOf(ms: number): number {
  return (ms / 1000) * 0.00025
}

type GenResp = {
  blueprint?: CreatureBlueprint
  ms?: number
  error?: string
  state?: string
  jobId?: string
  position?: number
  etaMs?: number
  /**
   * 服务端显式标注这个错误**值不值得重试**(见 `generate/route.ts`)。
   * 两种 429 一个等得起一个等不起,没有这个字段就只能靠猜错误文案。
   */
  retryable?: boolean
}

/** 退避上限:总共最多等 ~2 分钟,超过就认失败 */
const RETRY_DEADLINE_MS = 120_000

/**
 * POST 生成,**把限流当退避而不是失败**。
 *
 * 踩过的坑:原先任何非 2xx 都直接写进该行的 error。结果一批 30 只里只要有一瞬间
 * 撞上每 IP 每分钟的上限,8 路并发会在一两秒内把 30 行全部标成失败 —— 一次限流
 * 变成整批报废,而且**没有任何重试**。滑动窗口 60 次/分钟对「一次跑一批」这种
 * 正常用法本来就偏紧(开发态所有客户端还共用同一个 `local` 桶)。
 *
 * 只有 4xx(429 除外)是语义错误、重试没有意义;429 与 5xx 都退避重试。
 */
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

    /**
     * 429 有两种,性质完全相反,必须分开:
     *   - 「等一会儿就好」:每分钟太频繁、队列排满 → 退避重试有意义;
     *   - 「今天不会恢复」:每人 5 只用完、日预算见底 → 重试到天荒地老也没用。
     *
     * 之前我把两者混为一谈,于是后者被重试十几次(每次 8s,两分钟起步),
     * 页面只显示「限流,第 13 次」——**既慢又骗人**,真正的额度信息被盖住了。
     *
     * 优先读服务端显式给的 `retryable`;它缺失时才退回按文案猜(老响应 / 代理吞字段)。
     * 猜文案只是兜底:改一次提示文案就会静默失效,所以那不是主路径。
     */
    const permanent = j.retryable === false
    const retryable = (res.status === 429 && !permanent) || res.status >= 500
    if (!retryable || Date.now() - t0 > RETRY_DEADLINE_MS) {
      throw new Error(j.error || `HTTP ${res.status}`)
    }
    // 1s 起,指数退避到 ~8s 封顶,加抖动免得 8 路一起醒过来再撞一次
    const wait = Math.min(8000, 1000 * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.6)
    const secs = Math.round(wait / 100) / 10
    // 把**服务端给的真实原因**带出来,别一律显示「限流」——两种 429 一个等得起
    // 一个等不起,混成一句话就等于把诊断信息扔了
    const why = res.status === 429 ? (j.error ?? '请求过于频繁') : `服务异常 ${res.status}`
    onWait(`${why},${secs}s 后重试(第 ${attempt} 次)`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

/** 服务端返回 202(排队)时轮询取结果 */
async function pollJob(jobId: string): Promise<{ blueprint?: CreatureBlueprint; ms?: number }> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500))
    const res = await fetch(`/api/creature/generate?jobId=${encodeURIComponent(jobId)}`)
    if (!res.ok) throw new Error('排队记录已失效')
    const j = (await res.json()) as {
      state: string
      blueprint?: CreatureBlueprint
      ms?: number
      error?: string
    }
    if (j.state === 'done') return { blueprint: j.blueprint, ms: j.ms }
    if (j.state === 'error' || j.state === 'cancelled' || j.state === 'gone')
      throw new Error(j.error || '生成失败')
  }
}
