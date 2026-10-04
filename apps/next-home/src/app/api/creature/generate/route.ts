import { randomUUID } from 'node:crypto'
import { rateLimit, clientIp } from '@/lib/db'
import { chatProtocol, getChatApiKey, getConfig } from '@/lib/chat/config'
import { completeChatFull } from '@/lib/chat/llm'
import { defaultBaseUrl } from '@/lib/chat/providers'
import { isAdmin } from '@/lib/auth'
import { effectiveCid, isMockActive, resolveCid, cidCookie } from '@/lib/clientid'
import { normalizeBlueprint, compileBlueprint, type CreatureBlueprint } from '@zx/shared/creature'
import { buildGenerateMessages, GENERATE_BUDGETS } from '@/components/lab/blueprint/GENERATE_PROMPT'
import { extractJson } from '@/components/lab/blueprint/json'
import { queue, MAX_WAITERS } from '@/lib/creature/queue'
import { budgetDay, DAILY_PER_CID, cidsUsedToday, remainingForCid, reserve, settle } from '@/lib/creature/budget'

export const dynamic = 'force-dynamic'

interface Body {
  descr?: string
  /** 重试提示:把上一次的问题带回给模型 */
  retryHint?: string
  /** 取消一个已受理的任务(沿用 admin 蒸馏的 `{action:'cancel'}` 风格) */
  jobId?: string
  action?: string
}

function modelTarget() {
  const cfg = getConfig()
  const baseUrl = cfg.chatBaseUrl || defaultBaseUrl(cfg.chatProvider)
  const model = cfg.chatModel || 'deepseek-flash'
  return { cfg, baseUrl, model, apiKey: getChatApiKey() }
}

/* ---------- 轮询:查任务状态 ---------- */

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('jobId') ?? ''
  if (!id) return Response.json({ error: '缺少 jobId' }, { status: 400 })
  const job = queue().get(id)
  if (!job) {
    return Response.json({ state: 'gone' }, { status: 404 })
  }
  if (job.state === 'queued') {
    return Response.json({ state: 'queued', position: job.position, etaMs: job.etaMs })
  }
  if (job.state === 'running') return Response.json({ state: 'running' })
  if (job.state === 'done') return Response.json({ state: 'done', ...(job.result as object) })
  if (job.state === 'cancelled') return Response.json({ state: 'cancelled' })
  return Response.json(
    { state: 'error', error: job.error?.message ?? '生成失败', status: job.error?.status ?? 422 },
    { status: 200 },
  )
}

/* ---------- 发起生成 ---------- */

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body

  // 取消:还在排队就直接摘掉(不烧 token),已开跑则标记放弃(结果不再回传)
  if (body.action === 'cancel' && body.jobId) {
    const ok = queue().cancel(body.jobId)
    return Response.json({ cancelled: ok })
  }

  const descr = (body.descr ?? '').trim().slice(0, 300)
  if (!descr) return Response.json({ error: '描述不能为空' }, { status: 400 })

  const { baseUrl, model, apiKey } = modelTarget()
  if (!apiKey) {
    return Response.json({ error: '未配置模型 API Key(admin → 机器人)' }, { status: 503 })
  }
  if (!/^https?:\/\//.test(baseUrl)) {
    return Response.json({ error: '模型端点未配置' }, { status: 503 })
  }

  /**
   * 调试豁免:站长本人 **或** 开着 MOCK 访客 —— 两者都当作「不受每人每天 5 只」限制。
   * MOCK 是拿来看「访客视角」的,顺手在实验室里反复点很正常,所以一并豁免,
   * 省得每轮调试都先撞一次限流。注意**只豁免只数**,日预算照样记账。
   */
  const exempt = (await isAdmin()) || (await isMockActive())

  /**
   * **每 IP 每分钟的上限**:只挡脚本狂刷,不是主要闸门(排队深度 + 日预算才是)。
   *
   * 为什么放在 exempt 之后、且对 admin/MOCK 放行:这一页的正常用法就是**一次跑一批**
   * (`/lab/score` 一次 30 只,`/lab/species`「全部生成」一次 7 只)。滑动窗口按 IP 计,
   * 而开发态 `clientIp()` 拿不到 `x-forwarded-for`,所有本地客户端**共用一个 `local` 桶**
   * —— 于是「我自己用 curl 压测」和「站长时间开着页面」会互相把对方挤掉,
   * 整批 30 只在两三秒内全部 429。之前这个检查还排在 exempt 之前,
   * 也就是说**连站长自己都跑不了一批**。
   *
   * 真正的闸门是:`MAX_INFLIGHT` 12 个槽位 + `MAX_WAITERS` 队列深度 + 日预算 $2。
   * 连续狂刷真正会被挡住的地方是队列深度(队满直接 429),那个量和花费直接挂钩。
   */
  if (!exempt) {
    const ip = clientIp(req)
    if (!rateLimit(`creature-gen:${ip}`, 120, 60_000)) {
      return Response.json({ error: '生成太频繁,稍等一下' }, { status: 429 })
    }
  }
  /**
   * 访客身份:没有 cookie 就**当场发一个**。
   * 否则「每人每天 5 只」形同虚设 —— 直接访问 /lab/species(没先逛首页触发
   * /api/track 下发 cookie)的人每次请求都是「新访客」,永远停在 0 只。
   * 发 cookie 与 `/api/comments`、`/api/chat` 同一套做法(`resolveCid` + `cidCookie`)。
   */
  const existing = await effectiveCid()
  const { cid, isNew } = existing ? { cid: existing, isNew: false } : await resolveCid()
  const today = cidsUsedToday(cid, exempt)
  if (today >= DAILY_PER_CID) {
    return json({ error: `今天已经生成 ${today} 只了,明天再来(每人每天 ${DAILY_PER_CID} 只)` }, 429, isNew ? cid : '')
  }

  const jobId = randomUUID()
  const q = queue()

  /**
   * 有空位 → 立刻开跑,一次请求直接拿到结果(**常见路径,前端不用轮询**);
   * 没空位 → 返回 202 + jobId,前端轮询 `GET ?jobId=` 看位置与结果。
   */
  const slot = q.acquire(jobId, descr)
  if (slot === 'QUEUE_FULL') {
    return json({ error: `排队已经排到 ${MAX_WAITERS} 只了,前面还有一批在跑,过一会儿再试` }, 429, isNew ? cid : '')
  }
  if (!slot) {
    const out = await run(jobId, descr, body.retryHint, { baseUrl, model, apiKey, cid, exempt })
    return json(out.body, out.status, isNew ? cid : '')
  }

  // 排队:后台等轮到自己,完成后把结果写进 job;客户端轮询取
  void slot
    .then(() => run(jobId, descr, body.retryHint, { baseUrl, model, apiKey, cid, exempt }))
    .catch((e: Error) => {
      // 排队期间被取消 / 超时 —— 此时 `run` 压根没执行,也就没预扣过预算,无需 refund
      q.finish(jobId, e.message === 'CANCELLED' ? 'cancelled' : 'error', undefined, {
        message: e.message === 'CANCELLED' ? '已取消' : '排队超时,请重新生成',
        status: 429,
      })
    })

  const job = q.get(jobId)
  return json(
    {
      state: 'queued',
      jobId,
      position: job?.position ?? 1,
      etaMs: job?.etaMs ?? 45_000,
      remainingToday: Math.max(0, DAILY_PER_CID - today),
    },
    202,
    isNew ? cid : '',
  )
}

/** 统一出口:顺带把新访客的 `zx_cid` cookie 带上 */
function json(body: Record<string, unknown>, status: number, setCid?: string): Response {
  const h = new Headers({ 'Content-Type': 'application/json' })
  if (setCid) h.append('Set-Cookie', cidCookie(setCid))
  return new Response(JSON.stringify(body), { status, headers: h })
}

interface RunTarget {
  baseUrl: string
  model: string
  apiKey: string
  cid: string
  /** 调试豁免(admin 或 MOCK):不受每人每天 5 只限制 */
  exempt: boolean
}

/** 真正跑一次生成(含预算预扣 / 结算 / 槽位归还 / 终态落库) */
async function run(
  jobId: string,
  descr: string,
  retryHint: string | undefined,
  t: RunTarget,
): Promise<{ body: Record<string, unknown>; status: number }> {
  const q = queue()

  // 预算闸:真正开跑前才检查(排队期间不占额度),并记一笔在途预估
  const gate = reserve({ cid: t.cid, isAdminUser: t.exempt, model: t.model })
  if (!gate.ok) {
    const body = { error: gate.reason ?? '今天的生成额度用完了' }
    q.finish(jobId, 'error', undefined, { message: body.error, status: 429 })
    q.release()
    return { body, status: 429 }
  }

  try {
    const result = await generateOnce(descr, retryHint, t)
    const cost = settle({
      cid: t.cid,
      isAdminUser: t.exempt,
      model: t.model,
      ok: !('error' in result),
      tokens: 'tokens' in result ? result.tokens : undefined,
    })

    if ('error' in result) {
      const body = { error: result.error, raw: result.raw }
      q.finish(jobId, 'error', undefined, { message: result.error, status: result.status })
      return { body, status: result.status }
    }

    const compiled = compileBlueprint(result.bp)
    const body = {
      state: 'done',
      blueprint: result.bp,
      parts: compiled.rig.parts.length,
      ms: Date.now() - result.started,
      spentUsd: cost.usd,
      todayUsd: cost.todayUsd,
      budget: cost.budget,
      day: budgetDay(),
      remainingToday: remainingForCid(t.cid, t.exempt),
    }
    // 已被客户端取消的,结果就别浪费地回传了(但 token 已经花了,如实记账)
    const job = q.get(jobId)
    if (job?.state === 'cancelled') {
      q.finish(jobId, 'cancelled')
    } else {
      q.finish(jobId, 'done', body)
    }
    return { body, status: 200 }
  } finally {
    q.release()
  }
}

interface GenOk {
  bp: CreatureBlueprint
  started: number
  tokens: { input: number; output: number; cacheRead: number }
}

async function generateOnce(
  descr: string,
  retryHint: string | undefined,
  t: RunTarget,
): Promise<GenOk | { error: string; raw: string; status: number }> {
  const started = Date.now()
  /**
   * **总时限**,而不是「每次尝试各 120s」。
   *
   * 之前三次预算阶梯各有独立超时,最坏 3×120s=6 分钟,用户会以为页面卡死。
   * 现在整条链路共享一个 deadline,超了就不再往下试。
   */
  const DEADLINE = 180_000
  const messages = buildGenerateMessages(descr, retryHint)
  let lastRaw = ''
  let lastErr = ''

  for (const maxTokens of GENERATE_BUDGETS) {
    const remain = DEADLINE - (Date.now() - started)
    if (remain < 20_000) break // 剩下的时间不够一次生成,别再开新一轮
    let raw: string
    let inTokens = 0
    let outTokens = 0
    try {
      const r = await completeChatFull({
        protocol: chatProtocol(),
        baseUrl: t.baseUrl,
        apiKey: t.apiKey,
        model: t.model,
        messages,
        temperature: 1.0,
        maxTokens,
        signal: AbortSignal.timeout(Math.min(remain, 150_000)),
        sessionId: randomUUID(),
      })
      raw = r.text
      inTokens = r.inTokens ?? 0
      outTokens = r.outTokens ?? 0
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      continue
    }
    lastRaw = raw
    const parsed = extractJson(raw)
    const candidate = normalizeBlueprint(parsed)
    if (candidate) {
      return {
        bp: candidate,
        started,
        tokens: { input: inTokens, output: outTokens, cacheRead: 0 },
      }
    }
    lastErr = parsed ? 'JSON 结构不符合骨架要求' : '响应里没有可解析的 JSON'
  }

  return { error: lastErr || '模型没有给出可用的骨架', raw: lastRaw.slice(0, 400), status: 422 }
}