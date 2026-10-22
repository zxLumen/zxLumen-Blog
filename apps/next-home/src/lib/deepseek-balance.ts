import { getDb } from './db'
import { getGatewayConfig } from './ai-gateway'
import { getLastRows, setLastError } from './deepseek'

/**
 * DeepSeek **官方余额**哨兵。
 *
 * 背景:DeepSeek 至今没有开放的「用量」接口(官方只有 `GET /user/balance` 余额),
 * 明细只能抓网页控制台的私有接口 —— 平台一改版(2026-10-17 导出 CSV 加了 name 列)
 * 就会静默变成 0 行,面板整块消失且没有报错。这里用**官方余额**做交叉校验:
 *
 *   余额在下降(说明确实有消耗) 但 平台明细是 0 行 → 判定"解析/接口已失效",写 lastError,
 *   面板就会出红色角标,不用等你自己发现。
 *
 * 余额接口用 **API Key**(`sk-`)鉴权,不需要网页登录令牌,所以它不会跟着控制台改版一起挂。
 */

const K_LAST = 'deepseek_balance'
const K_DAILY = 'deepseek_balance_daily'
const OFFICIAL = 'https://api.deepseek.com/user/balance'

/** 余额多久刷新一次(官方接口很轻,6h 足够) */
const REFRESH_MS = 6 * 3600_000
/** 失败后多久再试(别把上游打爆) */
const FAIL_BACKOFF_MS = 30 * 60_000
/** 余额日历保留天数 */
const KEEP_DAYS = 30

export interface BalanceInfo {
  at: number
  ok: boolean
  currency?: string
  total?: number
  granted?: number
  toppedUp?: number
  available?: boolean
  error?: string
}

interface BalanceResp {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string
    granted_balance?: string
    topped_up_balance?: string
  }>
}

const bjDay = (ms = Date.now()) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10)

/** 从 AI 网关密钥池里挑一个 api.deepseek.com 的 key(余额查询只认 API Key) */
export function pickDeepseekApiKey(): string {
  try {
    const cfg = getGatewayConfig()
    const hit = cfg.providers.find(
      (p) => p.enabled && p.apiKey && /(^|\.)api\.deepseek\.com/i.test(p.baseUrl),
    )
    return hit?.apiKey ?? ''
  } catch {
    return ''
  }
}

function readLast(): BalanceInfo | null {
  const raw = getDb().getMeta(K_LAST)
  if (!raw) return null
  try {
    return JSON.parse(raw) as BalanceInfo
  } catch {
    return null
  }
}

function readDaily(): Record<string, number> {
  const raw = getDb().getMeta(K_DAILY)
  if (!raw) return {}
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(o)) {
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
    return out
  } catch {
    return {}
  }
}

/** 最近一个「非今天」的余额(用于算差值) */
function prevDaily(daily: Record<string, number>, today: string): { day: string; total: number } | null {
  const days = Object.keys(daily)
    .filter((d) => d < today)
    .sort()
  const day = days[days.length - 1]
  return day ? { day, total: daily[day] } : null
}

/** 拉一次官方余额并落库(成功/失败都记,便于面板显示"上次校验") */
export async function refreshBalance(): Promise<BalanceInfo> {
  const key = pickDeepseekApiKey()
  const now = Date.now()
  if (!key) {
    const info: BalanceInfo = { at: now, ok: false, error: '密钥池里没有 api.deepseek.com 的 API Key' }
    getDb().setMeta(K_LAST, JSON.stringify(info))
    return info
  }
  try {
    const res = await fetch(OFFICIAL, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`官方余额接口 HTTP ${res.status}`)
    const j = (await res.json()) as BalanceResp
    const infos = j.balance_infos ?? []
    const cny = infos.find((b) => b.currency === 'CNY') ?? infos[0]
    if (!cny) throw new Error('官方余额返回为空')
    const total = Number(cny.total_balance)
    if (!Number.isFinite(total)) throw new Error('官方余额数值无法解析')
    const info: BalanceInfo = {
      at: now,
      ok: true,
      currency: cny.currency ?? 'CNY',
      total,
      granted: Number(cny.granted_balance) || 0,
      toppedUp: Number(cny.topped_up_balance) || 0,
      available: j.is_available !== false,
    }
    getDb().setMeta(K_LAST, JSON.stringify(info))
    // 记当天余额(同一天多次刷新取最后一次),只保留最近 KEEP_DAYS 天
    const daily = readDaily()
    daily[bjDay(now)] = total
    const keep = Object.keys(daily)
      .sort()
      .slice(-KEEP_DAYS)
    const trimmed: Record<string, number> = {}
    for (const d of keep) trimmed[d] = daily[d]
    getDb().setMeta(K_DAILY, JSON.stringify(trimmed))
    await auditAgainstBalance(info, trimmed)
    return info
  } catch (e) {
    const info: BalanceInfo = {
      at: now,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
    getDb().setMeta(K_LAST, JSON.stringify(info))
    return info
  }
}

/**
 * 交叉校验:余额比上次记录少了(有消耗),但平台明细一行都没有 → 明细接口/解析已失效。
 * 只写 lastError(面板会显示红色角标),不清空余额记录。
 */
async function auditAgainstBalance(info: BalanceInfo, daily: Record<string, number>): Promise<void> {
  if (!info.ok || typeof info.total !== 'number') return
  const today = bjDay(info.at)
  const prev = prevDaily(daily, today)
  if (!prev) return
  const spent = Math.round((prev.total - info.total) * 100) / 100
  if (!(spent > 0.01)) return
  const rows = await getLastRows('30d')
  if (rows && rows.rows.length > 0) return
  await setLastError(
    `余额较 ${prev.day} 减少 ¥${spent.toFixed(2)},但平台用量明细为 0 行 —— DeepSeek 导出接口/字段可能又改版了`,
  )
}

/** 缓存读:超过 REFRESH_MS(失败则 FAIL_BACKOFF_MS)才重新拉 */
let inflight: Promise<BalanceInfo> | null = null

export async function getBalance(): Promise<BalanceInfo | null> {
  const last = readLast()
  const age = last ? Date.now() - last.at : Infinity
  const ttl = last && !last.ok ? FAIL_BACKOFF_MS : REFRESH_MS
  if (last && age < ttl) return last
  if (!inflight) {
    inflight = refreshBalance().finally(() => {
      inflight = null
    })
  }
  try {
    return await inflight
  } catch {
    return last
  }
}

/** 今日 vs 上一次记录的花费(正数=花了钱);没有可比数据返回 null */
export function spentSincePrev(balance: BalanceInfo | null): { day: string; spent: number } | null {
  if (!balance?.ok || typeof balance.total !== 'number') return null
  const daily = readDaily()
  const today = bjDay(balance.at)
  const prev = prevDaily(daily, today)
  if (!prev) return null
  return { day: prev.day, spent: Math.round((prev.total - balance.total) * 100) / 100 }
}

/** 6 小时一次的余额采样(幂等;dev 热更新用 globalThis 去重) */
export function ensureBalanceScheduler(): void {
  const g = globalThis as unknown as { __dsBalanceTimer?: ReturnType<typeof setInterval> }
  if (g.__dsBalanceTimer) return
  g.__dsBalanceTimer = setInterval(() => void getBalance(), REFRESH_MS)
  // 别让定时器把 Node 进程挂住(测试/构建环境)
  ;(g.__dsBalanceTimer as unknown as { unref?: () => void }).unref?.()
  void getBalance()
}
