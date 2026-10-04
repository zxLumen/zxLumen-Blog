import { fitBradleyTerry, reconcilePair, type PairResult, type PairOutcome } from '@zx/shared/creature'
import { judgePair } from './judge-vlm'

/**
 * 榜单的 VLM 精排 —— **只在 Top 边界做**,不参与每只生物的绝对打分。
 *
 * ## 为什么这样设计
 *
 *  - **分(绝对刻度)永远来自 `heur`**。VLM 只回答「这两只谁更好看」,把边界处的
 *    顺序调得更贴人眼。它不产出分数,所以不需要跨批次锚定,也不会把排行榜交给一个
 *    会抖动、会花钱、可被 prompt 注入的裁判。
 *  - 触发方式是**榜缓存过期时批量重排**(不是每次访问) —— 成本可控。
 *  - **硬兜底**:任何一次裁判失败 / 没配 key / 超时 → 直接退回纯 heur 顺序,
 *    榜单永远返回得出来。
 *
 * ## 候选与配对策略
 *
 *  取 heur 前若干只(候选池),对**相邻名次**成对比较(第 k 与第 k+1):
 *  相邻对的胜负才真正决定名次,跨名次的比较信息冗余。对每一对**双向各问一次**
 *  (`reconcilePair` 内部翻面),不一致判平局 —— 位置偏差的直接对策。
 *  用 Davidson BT 把整组比较拟合成强度,按强度重排。
 */

export interface RerankItem {
  id: number
  /** data URL(png);没有图则不参与比较 */
  png: string
}

export interface RerankResult {
  /** 精排后的 id 顺序(只含参与了比较的项) */
  order: number[]
  /** 实际发生的裁判调用次数(双向,成对 ×2) */
  calls: number
  /** 双向不一致的对数 */
  disagreed: number
  /** 是否真的用上了 VLM(没有图 / 无 key / 全失败 → false,调用方退回 heur) */
  applied: boolean
}

/**
 * 对候选池做相邻成对精排。
 *
 * @param items 已按 heur 降序排好的候选(需带图)
 * @param maxPairs 最多比较多少对(预算闸门);默认取边界附近足够重排 Top5 的量
 */
export async function rerankTop(
  items: readonly RerankItem[],
  maxPairs = 6,
): Promise<RerankResult> {
  const withImg = items.filter((i) => i.png)
  if (withImg.length < 2) return { order: items.map((i) => i.id), calls: 0, disagreed: 0, applied: false }

  // 相邻对(第 k,第 k+1),最多 maxPairs 对
  const pairsToAsk: Array<[RerankItem, RerankItem]> = []
  for (let k = 0; k + 1 < withImg.length && pairsToAsk.length < maxPairs; k++) {
    pairsToAsk.push([withImg[k]!, withImg[k + 1]!])
  }

  const btPairs: PairResult[] = []
  let calls = 0
  let disagreed = 0
  let ok = 0

  for (const [x, y] of pairsToAsk) {
    // 双向各问一次;judgePair 不抛错,失败时 verdict=null
    const fwd = await judgePair(x.png, y.png)
    const rev = await judgePair(y.png, x.png)
    calls += 2
    if (!fwd.verdict || !rev.verdict) continue

    const ab = toOutcome(fwd.verdict)
    const ba = toOutcome(rev.verdict)
    const rec = reconcilePair(String(x.id), String(y.id), ab, ba)
    if (rec.disagreed) disagreed++
    if (!rec.disagreed) ok++
    btPairs.push({ a: String(x.id), b: String(y.id), outcome: rec.outcome })
  }

  // 一对都没成功 → 退回 heur 顺序
  if (ok === 0) return { order: items.map((i) => i.id), calls, disagreed, applied: false }

  const ids = withImg.map((i) => String(i.id))
  const bt = fitBradleyTerry(ids, btPairs)
  const strength = (id: string) => bt.theta[id] ?? 0

  // 参与比较的按 BT 强度降序;没参与比较的(无图)保持原相对位置接在后面
  const rankedCompared = [...withImg].sort((a, b) => strength(String(b.id)) - strength(String(a.id)))
  const rest = items.filter((i) => !i.png)
  const order = [...rankedCompared, ...rest].map((i) => i.id)

  return { order, calls, disagreed, applied: true }
}

/** 路由返回的第一张/第二张(A/B)→ BT 的 outcome 语义(站在第一张的角度) */
function toOutcome(v: 'A' | 'B' | '平局'): PairOutcome {
  return v === 'A' ? 'a' : v === 'B' ? 'b' : 'tie'
}
