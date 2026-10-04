// 生物生成的**花费闸**:日预算 + 每 cookie 每日次数,都落 `meta`(重启不丢)。
//
// 为什么必须有这个:并发闸防不住「慢慢地把配额烧穿」。真正的硬限额是
// OpenCode Go 的 5 小时 / 周 / 月配额(以及 $10/月 订阅),而单次生成约
// $0.0045(off-peak)~ $0.0089(peak)。按 $2/天 算约 440 次/天,足够单人实验,
// 又不至于某天顺手点几百下把配额烧光。
//
// 计数用 meta 而不是纯内存:纯内存在重启后归零,等于每天给了一个「免费重置」,
// 拦不住反复重启刷量(虽然重启需要服务器权限,但没必要留这个洞)。
//
// 关键设计:**先按最坏情况预扣,再按实际用量结算**。
// 只在事后累加的话,12 个并发请求会同时通过检查、全部开跑,结束时才发现超预算 ——
// 那时钱已经花了。所以:
//   1. `reserve()` 在**开跑前**检查余额并记一笔「在途预估」(按 PEAK 价估,宁可高估);
//   2. `settle()` 在**跑完后**用真实 token 把它换成实际花费。

import { estimateGoCost, isGoModelKnown } from '@zx/shared'
import { getDb } from '@/lib/db'

/**
 * 日预算上限(USD)。
 *
 * 为什么从 2 提到 6:`/lab/score` 一批就是 30 只 ≈ $1.1,而调评分公式是要**反复跑批**
 * 的(换权重要看分布、验一个假设要重跑)。$2 一天只够不到两批,等于「限流」而不是
 * 「限额」—— 自己把自己的调试流程卡死,却对真正的失控脚本毫无作用(那种场景
 * 30 秒就能烧掉 $2,靠的不是上限高低)。
 *
 * 可用 `ZX_CREATURE_DAILY_BUDGET` 覆盖,不用改代码。
 *
 * ⚠ 这仍是**真金白银的闸门**,故意保留:没有它,一个死循环脚本能在一天内把
 * $10/月 的订阅烧光(实测单次 $0.0045~$0.0089,$6 ≈ 700~1300 次)。
 * 「demo 不限流」指的是不限**请求频率**,不是不限**花费**。
 */
export const DAILY_BUDGET_USD = Number(process.env.ZX_CREATURE_DAILY_BUDGET ?? 6)

/** 同一 cookie 每天最多生成几只 */
export const DAILY_PER_CID = 5

/** 单次生成的费用兜底:模型不在 Go 价目表里时按这个估,免得换模型后闸门静默失效 */
const FALLBACK_MAX_PER_CALL = 0.02

/** 单次生成 tokens 的兜底估算(实测输入 ~2k、输出 ~7k) */
const FALLBACK_INPUT_TOKENS = 2_000
const FALLBACK_OUTPUT_TOKENS = 7_000

const K_SPEND = (day: string) => `creature_spend_${day}`
const K_CIDS = (day: string) => `creature_cids_${day}`

/** 北京时间日(配额也应按用户所在时区算) */
export function budgetDay(now = Date.now()): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10)
}

interface SpendRow {
  /** 今天已实际花费 */
  usd: number
  /** 今天已完成的生成次数 */
  gens: number
  /** 当前在途的预估花费(跑完后结算掉) */
  reserved: number
}

function readSpend(day: string): SpendRow {
  const raw = getDb().getMeta(K_SPEND(day))
  if (!raw) return { usd: 0, gens: 0, reserved: 0 }
  try {
    const j = JSON.parse(raw) as Partial<SpendRow>
    return {
      usd: Number(j.usd) || 0,
      gens: Number(j.gens) || 0,
      reserved: Number(j.reserved) || 0,
    }
  } catch {
    return { usd: 0, gens: 0, reserved: 0 }
  }
}

function writeSpend(day: string, row: SpendRow) {
  getDb().setMeta(K_SPEND(day), JSON.stringify(row))
}

function readCids(day: string): Record<string, number> {
  const raw = getDb().getMeta(K_CIDS(day))
  if (!raw) return {}
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(j)) out[k] = Number(v) || 0
    return out
  } catch {
    return {}
  }
}

function writeCids(day: string, map: Record<string, number>) {
  getDb().setMeta(K_CIDS(day), JSON.stringify(map))
}

/** 单次生成的最坏预估费用(按 peak 价,宁可高估) */
function worstCaseUsd(model: string): number {
  const now = Date.now()
  if (isGoModelKnown(model)) {
    const c = estimateGoCost(model, now, {
      input: FALLBACK_INPUT_TOKENS * 2,
      output: FALLBACK_OUTPUT_TOKENS * 2,
      cacheRead: 0,
    })
    if (c > 0) return c
  }
  return FALLBACK_MAX_PER_CALL
}

/** 今天这个 cookie 已经生成了几只(站长豁免,返回 0) */
export function cidsUsedToday(cid: string, isAdminUser: boolean): number {
  if (isAdminUser || !cid) return 0
  return readCids(budgetDay())[cid] ?? 0
}

/** 今天这个 cookie 还能生成几只(前端提示用) */
export function remainingForCid(cid: string, isAdminUser: boolean): number {
  if (isAdminUser || !cid) return DAILY_PER_CID
  return Math.max(0, DAILY_PER_CID - (readCids(budgetDay())[cid] ?? 0))
}

export interface ReserveResult {
  ok: boolean
  /** 被拒时的中文原因(直接给访客看) */
  reason?: string
  /** 被拒时建议的等待秒数(前端可据此提示) */
  retryAfterS?: number
}

/**
 * 开跑前的闸:检查日预算 + 每 cookie 次数,并**记下在途预估**。
 * 成功后必须配对调用 `settle()`(成功或失败都要调,把预扣换掉)。
 */
export function reserve(opts: {
  cid: string
  isAdminUser: boolean
  model: string
}): ReserveResult {
  const day = budgetDay()

  if (!opts.isAdminUser && opts.cid) {
    const used = readCids(day)[opts.cid] ?? 0
    if (used >= DAILY_PER_CID) {
      return { ok: false, reason: `今天已经生成 ${used} 只了,明天再来(每人每天 ${DAILY_PER_CID} 只)` }
    }
  }

  const row = readSpend(day)
  const worst = worstCaseUsd(opts.model)
  const committed = row.usd + row.reserved
  if (committed + worst > DAILY_BUDGET_USD) {
    const pct = Math.round((committed / DAILY_BUDGET_USD) * 100)
    return {
      ok: false,
      reason: `今天的生成预算快用完了(${Math.min(pct, 100)}%),明天再来`,
    }
  }

  row.reserved += worst
  writeSpend(day, row)
  return { ok: true }
}

export interface SettleResult {
  /** 本次调用实际花费(USD) */
  usd: number
  /** 今天**实际**累计花费(单调递增,用于展示) */
  todayUsd: number
  /** 今天「实际 + 在途预扣」,只用于闸门判断,会随结算上下浮动 */
  committed: number
  budget: number
  /** 本次调用是否计入了 gens —— 计 cookie 次数 */
  counted: boolean
}

/**
 * 跑完后的结算:把预扣换成实际花费,并给这个 cookie 记一次。
 * @param ok 这次生成是否成功(失败通常几乎不花钱,但仍要结算掉预扣)
 */
export function settle(opts: {
  cid: string
  isAdminUser: boolean
  model: string
  ok: boolean
  tokens?: { input: number; output: number; cacheRead: number }
}): SettleResult {
  const day = budgetDay()
  const row = readSpend(day)
  const worst = worstCaseUsd(opts.model)

  let usd = 0
  if (opts.ok && opts.tokens) {
    // 未收录模型会返回 0 —— 那就按 off-peak 兜底价算,不能记 0(否则闸门形同虚设)
    usd =
      estimateGoCost(opts.model, Date.now(), opts.tokens) ||
      (opts.tokens.input * 0.15 + opts.tokens.output * 0.6) / 1e6
  }

  row.reserved = Math.max(0, row.reserved - worst)
  row.usd += usd

  let counted = false
  if (opts.ok && !opts.isAdminUser && opts.cid) {
    const map = readCids(day)
    map[opts.cid] = (map[opts.cid] ?? 0) + 1
    writeCids(day, map)
    row.gens += 1
    counted = true
  }
  writeSpend(day, row)

  return {
    usd,
    todayUsd: row.usd,
    committed: row.usd + row.reserved,
    budget: DAILY_BUDGET_USD,
    counted,
  }
}

/** 把在途预扣还回去(排队超时/取消,模型压根没被调用) */
export function refund(opts: { model: string }) {
  const day = budgetDay()
  const row = readSpend(day)
  row.reserved = Math.max(0, row.reserved - worstCaseUsd(opts.model))
  writeSpend(day, row)
}

/** 今天的花费概览(admin 面板 / 前端提示用) */
export function todaySpend(now = Date.now()) {
  const row = readSpend(budgetDay(now))
  return {
    day: budgetDay(now),
    usd: row.usd,
    reserved: row.reserved,
    gens: row.gens,
    budget: DAILY_BUDGET_USD,
  }
}