// 蒸馏流水线(admin 触发,粗暴但可用):
//   1) 扫描 corpus/*.
//   2) 对每个文件分类(a 人格素材 / b 事实知识)并写入 kb_docs
//   3) 知识类 → 切块 + embedding → kb_chunks(可增量:sha 不变跳过)
//   4) 人格类 → 由全量 corpus 生成 persona.md + faq.json 落盘
import { getDb } from '../db'
import { getConfig, getChatApiKey } from './config'
import type { ChatBotConfig } from './config'
import { completeChat, embedTexts } from './llm'
import { chatProtocol, embedProtocol, getEmbedApiKey, embedReady } from './config'
import { listCorpus, writeSoulFiles, soulDir, publicContactExempt, type CorpusFile } from './soul'
import { sanitizeText, countHits, type SanHit } from './sanitize'
import { junkReason } from './junk'

export interface CorpusStatusItem {
  name: string
  rel: string
  size: number
  sha: string
  kind: 'persona' | 'knowledge' | null
  origin: 'override' | 'directive' | 'rule' | 'auto'
  status: 'pending' | 'processed' | 'error' | 'ignored'
  error: string
  fromDb: boolean
  /** 垃圾检测结果(auto=自动跳过,hint=仅提示) */
  junk?: { auto: boolean; reason: string } | null
  /** 是否已由站长「恢复入库」(豁免自动过滤) */
  nokeep?: boolean
}

/** char 级切块(500/75,与 RAG 项目 chunk_size/overlap 一致) */
export function chunkText(text: string, size = 500, overlap = 75): string[] {
  const clean = text.replace(/[\r\n]+/g, '\n')
  if (clean.length <= size) return clean.trim() ? [clean.trim()] : []
  const out: string[] = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length)
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end)
      if (nl > i + size * 0.6) end = nl
    }
    const piece = clean.slice(i, end).trim()
    if (piece) out.push(piece)
    if (end >= clean.length) break
    i = i === end ? end + 1 : end - overlap
  }
  return out
}

interface ClassifyResult {
  kind: 'persona' | 'knowledge'
  title: string
  note: string
}

/** 用 LLM 判断某段文字该进"人格"还是"知识库";推理模型偶发只输出思考,自动重试一次并放大预算 */
export async function classifyText(cfg: ChatBotConfig, name: string, text: string): Promise<ClassifyResult> {
  const prompt = [
    `下面是一段刘子祥(zxLumen)站点的文字素材,文件名 ${name}。`,
    `请判断它属于哪一类:`,
    `- persona:偏向"他这个人"——个人经历、观点、性格、随笔、想法、自述、价值观、问答语录。适合作为 ai 分身的人格。`,
    `- knowledge:偏向"客观知识/事实"——技能干货、教程、项目细节、API 用法、配置、数据、代码知识。适合入库供检索。`,
    `只输出一行 JSON,不要任何其它文字:{"kind":"persona|knowledge","title":"12字内的题目","note":"一句话理由"}`,
    ``,
    `素材开头 2000 字:`,
    text.slice(0, 2000),
  ].join('\n')

  const call = async (maxTokens: number): Promise<ClassifyResult | null> => {
    const raw = await completeChat({
      protocol: chatProtocol(),
      baseUrl: cfg.chatBaseUrl,
      apiKey: getChatApiKey(),
      model: cfg.chatModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxTokens,
      provider: cfg.chatProvider,
      sessionId: `distill:classify:${encodeURIComponent(name)}`,
      sanitize: true,
    })
    if (!raw) return null
    const m = raw.match(/\{[\s\S]*?\}/)
    if (!m) return null
    const j = JSON.parse(m[0]) as { kind?: string; title?: string; note?: string }
    const kind = j.kind === 'knowledge' ? 'knowledge' : 'persona'
    return { kind, title: j.title || name, note: j.note || '' } as ClassifyResult
  }

  const first = await call(1000)
  if (first) return first
  const retry = await call(2000).catch(() => null)
  if (retry) return retry
  throw new Error('LLM 未返回 JSON(可能被 max_tokens 截断;推理模型请加大预算)')
}

/* ---------- 类别判定优先级:手动覆盖 > 文件头指令 > 文件名/目录规则 > LLM ---------- */

export type CorpusKind = 'persona' | 'knowledge'
export type KindOrigin = 'override' | 'directive' | 'rule' | 'auto'

const K_OVERRIDES = 'chatbot_kind_overrides'

/** 手动类别覆盖(source 相对路径 → 类别);空串等非法值忽略 */
export function getKindOverrides(): Record<string, CorpusKind> {
  const raw = getDb().getMeta(K_OVERRIDES)
  if (!raw) return {}
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, CorpusKind> = {}
    for (const [k, v] of Object.entries(j)) if (v === 'persona' || v === 'knowledge') out[k] = v
    return out
  } catch {
    return {}
  }
}

/** 设置/清除手动覆盖(kind='auto' 表示恢复自动) */
export function setKindOverride(source: string, kind: CorpusKind | 'auto'): void {
  const db = getDb()
  const cur = getKindOverrides()
  if (kind === 'auto') delete cur[source]
  else cur[source] = kind
  if (Object.keys(cur).length) db.setMeta(K_OVERRIDES, JSON.stringify(cur))
  else db.delMeta(K_OVERRIDES)
}

/* ---------- 敏感信息:按文件「放行」清单 + 脱敏记录 ---------- */

const S_ALLOW = 'chatbot_sensitive_allow'
const S_MAP = 'chatbot_sanitized'

/** 被显式「放行」(按原文蒸馏)的相对路径集合 */
export function getSensitiveAllowed(): Record<string, boolean> {
  const raw = getDb().getMeta(S_ALLOW)
  if (!raw) return {}
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(j)) if (v === true) out[k] = true
    return out
  } catch {
    return {}
  }
}

/** 放行 / 恢复脱敏(allow=false 时移除并重跑蒸馏) */
export function setSensitiveAllowed(source: string, allow: boolean): void {
  const db = getDb()
  const cur = getSensitiveAllowed()
  if (allow) cur[source] = true
  else delete cur[source]
  if (Object.keys(cur).length) db.setMeta(S_ALLOW, JSON.stringify(cur))
  else db.delMeta(S_ALLOW)
}

/** 文件删除时清理其敏感记录(放行 + 脱敏快照都删) */
export function clearSensitiveFor(source: string): void {
  const db = getDb()
  const allow = getSensitiveAllowed()
  if (allow[source]) {
    delete allow[source]
    if (Object.keys(allow).length) db.setMeta(S_ALLOW, JSON.stringify(allow))
    else db.delMeta(S_ALLOW)
  }
  const map = getSanitizedMap()
  if (map[source]) {
    delete map[source]
    if (Object.keys(map).length) db.setMeta(S_MAP, JSON.stringify(map))
    else db.delMeta(S_MAP)
  }
  // 顺带清掉「恢复入库」记录,保持与 sensitive 一致
  const keep = getJunkKeep()
  if (keep[source]) {
    delete keep[source]
    if (Object.keys(keep).length) db.setMeta(JUNK_KEEP, JSON.stringify(keep))
    else db.delMeta(JUNK_KEEP)
  }
}

/** 自动过滤时被站长「恢复入库」豁免的相对路径集合(meta 持久化) */
const JUNK_KEEP = 'chatbot_junk_keep'

export function getJunkKeep(): Record<string, boolean> {
  const raw = getDb().getMeta(JUNK_KEEP)
  if (!raw) return {}
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(j)) if (v === true) out[k] = true
    return out
  } catch {
    return {}
  }
}

/** 恢复入库(ignore=false)/ 恢复自动过滤(ignore=true) */
export function setJunkKeep(source: string, keep: boolean): void {
  const db = getDb()
  const cur = getJunkKeep()
  if (keep) cur[source] = true
  else delete cur[source]
  if (Object.keys(cur).length) db.setMeta(JUNK_KEEP, JSON.stringify(cur))
  else db.delMeta(JUNK_KEEP)
}

export interface SanitizedInfo {
  /** 硬检测命中:label → 次数 */
  hard: Record<string, number>
  /** 语境检测命中:label → 次数 */
  ctx: Record<string, number>
  at: string
}

/** 最近一次蒸馏各 corpus 文件的脱敏记录(供面板展示「⚠ 已脱敏」) */
export function getSanitizedMap(): Record<string, SanitizedInfo> {
  const raw = getDb().getMeta(S_MAP)
  if (!raw) return {}
  try {
    const j = JSON.parse(raw) as Record<string, SanitizedInfo>
    return j
  } catch {
    return {}
  }
}

function recordSanitized(source: string, hits: SanHit[]): void {
  const db = getDb()
  const map = getSanitizedMap()
  if (!hits.length) {
    if (map[source]) delete map[source]
  } else {
    const hard = countHits(hits.filter((h) => h.group === 'hard'))
    const ctx = countHits(hits.filter((h) => h.group === 'ctx'))
    map[source] = { hard, ctx, at: new Date().toISOString() }
  }
  if (Object.keys(map).length) db.setMeta(S_MAP, JSON.stringify(map))
  else db.delMeta(S_MAP)
}

/** 单个 corpus 文件的「可用文本」:被放行则用原文,否则脱敏(仅记录命中,不改磁盘) */
async function sanitizeFor(
  file: { text: string; rel: string },
  exempt: string[],
): Promise<{ text: string; hits: SanHit[] }> {
  if (getSensitiveAllowed()[file.rel]) return { text: file.text, hits: [] }
  if (exempt.length) return sanitizeText(file.text, { exempt })
  return sanitizeText(file.text)
}

/** 文件头指令:前 500 字里 `<!-- kind: knowledge -->` 或独占一行 `kind: persona` */
function kindFromDirective(text: string): CorpusKind | null {
  const head = text.slice(0, 500)
  const m =
    head.match(/<!--\s*kind:\s*(persona|knowledge)\s*-->/i) ??
    head.match(/^[ \t>*-]*kind:\s*(persona|knowledge)\s*$/im)
  return m ? (m[1].toLowerCase() as CorpusKind) : null
}

const KNOWLEDGE_HINTS = ['site-content', 'content', 'knowledge', 'api', 'docs', 'faq', '技术']
const PERSONA_HINTS = ['about-me', 'about_me', 'aboutme', 'resume', 'persona', 'self-intro', '自述', '随笔']

/** 文件名/目录规则(确定性) */
export function kindFromName(name: string, rel: string): CorpusKind | null {
  const n = name.toLowerCase()
  const r = rel.toLowerCase().replace(/\\/g, '/')
  if (r.includes('corpus/knowledge/')) return 'knowledge'
  if (r.includes('corpus/persona/')) return 'persona'
  if (KNOWLEDGE_HINTS.some((h) => n.includes(h))) return 'knowledge'
  if (PERSONA_HINTS.some((h) => n.includes(h))) return 'persona'
  return null
}

/** 不含 LLM 的来源判定(用于显示已在库的文件) */
export function originOf(rel: string, name: string, text: string): KindOrigin {
  if (getKindOverrides()[rel]) return 'override'
  if (kindFromDirective(text)) return 'directive'
  if (kindFromName(name, rel)) return 'rule'
  return 'auto'
}

/** 组装一个知识库源文件的全部 chunk 文本 */
export function chunksOf(text: string, cfg: ChatBotConfig): string[] {
  return chunkText(text, cfg.chunkSize || 500, cfg.chunkOverlap || 75)
}
/** 把知识片段写入 kb_chunks(向量可选:embedding 未配置时只存文本,关键词可用) */
export async function indexChunks(
  cfg: ChatBotConfig,
  docId: number,
  source: string,
  chunks: string[],
): Promise<void> {
  const db = getDb()
  let vectors: number[][] | null = null
  if (embedReady()) {
    try {
      vectors = await embedTexts({
        protocol: embedProtocol(),
        baseUrl: cfg.embedBaseUrl,
        apiKey: getEmbedApiKey(),
        model: cfg.embedModel,
        texts: chunks,
      })
      if (vectors.length !== chunks.length) vectors = null
    } catch {
      vectors = null
    }
  }
  db.clearKbChunks(docId)
  chunks.forEach((c, i) => {
    const v = vectors?.[i] ?? null
    db.addKbChunk({
      doc_id: docId,
      idx: i,
      content: c,
      vector: v ? Buffer.from(Float32Array.from(v).buffer) : null,
      source,
      token_len: c.length,
    })
  })
}

/* ---------- 分类:批量 + 并发(省 token、省时间) ---------- */

/** 每个批量调用里的素材数 / 每篇截断字符 / 同时跑几批 / 同时入库几个 */
const BATCH_SIZE = 10
const BATCH_CHARS = 1200
const BATCH_CONC = 4
const COMMIT_CONC = 4

/** 并行执行,限制同时进行数;结果按输入顺序返回 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) break
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

const fallbackClassify = (name: string): ClassifyResult => ({
  kind: 'knowledge',
  title: name.replace(/\.[^.]+$/, ''),
  note: 'llm 兜底',
})

/** 一次调用给多篇素材分类;返回 null 表示解析失败(交由上层重试/拆分) */
async function classifyBatch(
  cfg: ChatBotConfig,
  files: Array<{ name: string; text: string }>,
  maxTokens: number,
): Promise<ClassifyResult[] | null> {
  const body = files.map((f, i) => `【${i}】文件名:${f.name}\n${f.text.slice(0, BATCH_CHARS)}`).join('\n\n')
  const prompt = [
    `你是分类助手。下面有 ${files.length} 段刘子祥(zxLumen)站点的文字素材,按编号【i】标注。`,
    `逐段判断类型:`,
    `- persona:偏向"他这个人"——个人经历、观点、性格、随笔、想法、自述、价值观、问答语录。`,
    `- knowledge:偏向"客观知识/事实"——技能干货、教程、项目细节、API 用法、配置、数据、代码知识。`,
    `只输出 JSON 数组,不要任何其它文字;每段一项:{"i":0,"kind":"persona|knowledge","title":"12字内题目"}`,
    ``,
    body,
  ].join('\n')
  const raw = await completeChat({
    protocol: chatProtocol(),
    baseUrl: cfg.chatBaseUrl,
    apiKey: getChatApiKey(),
    model: cfg.chatModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens,
    provider: cfg.chatProvider,
    sessionId: 'distill:classify:batch',
    sanitize: true,
  })
  if (!raw) return null
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return null
  let arr: unknown
  try {
    arr = JSON.parse(m[0])
  } catch {
    return null
  }
  if (!Array.isArray(arr)) return null
  const byI = new Map<number, { kind: string; title?: string }>()
  for (const it of arr) {
    const o = it as { i?: unknown; kind?: unknown; title?: unknown }
    if (typeof o?.i === 'number') {
      byI.set(o.i, { kind: String(o.kind ?? ''), title: typeof o.title === 'string' ? o.title : undefined })
    }
  }
  if (byI.size < files.length) return null
  return files.map((f, i) => {
    const o = byI.get(i)!
    return {
      kind: o.kind === 'knowledge' ? 'knowledge' : 'persona',
      title: (o.title && o.title.trim()) || f.name.replace(/\.[^.]+$/, ''),
      note: '',
    }
  })
}

/** 给一组素材分类:1 篇直接单发;多篇先批量,失败则拆半递归(最终退化为逐篇) */
async function classifyGroup(cfg: ChatBotConfig, files: Array<{ name: string; text: string }>): Promise<ClassifyResult[]> {
  if (files.length === 1) {
    try {
      return [await classifyText(cfg, files[0].name, files[0].text)]
    } catch {
      return [fallbackClassify(files[0].name)]
    }
  }
  for (const maxTokens of [2048, 4096]) {
    try {
      const r = await classifyBatch(cfg, files, maxTokens)
      if (r) return r
    } catch {
      /* 换更大预算再试 */
    }
  }
  const mid = Math.ceil(files.length / 2)
  const [a, b] = await Promise.all([
    classifyGroup(cfg, files.slice(0, mid)),
    classifyGroup(cfg, files.slice(mid)),
  ])
  return [...a, ...b]
}

/** 确定性分类(不调 LLM):手动覆盖 > 文件头指令 > 文件名/目录规则 */
function fastKind(rel: string, name: string, text: string): { kind: CorpusKind; title: string; origin: KindOrigin } | null {
  const title = name.replace(/\.[^.]+$/, '')
  const ov = getKindOverrides()[rel]
  if (ov) return { kind: ov, title, origin: 'override' }
  const dir = kindFromDirective(text)
  if (dir) return { kind: dir, title, origin: 'directive' }
  const rule = kindFromName(name, rel)
  if (rule) return { kind: rule, title, origin: 'rule' }
  return null
}

/* ---------- 后台蒸馏任务 + 进度(供面板轮询) ---------- */

export interface DistillProgress {
  running: boolean
  force: boolean
  total: number
  done: number
  ok: number
  ignored: number
  error: number
  current: string
  startedAt: string
  finishedAt: string | null
}

let activeJob: DistillProgress | null = null
const P_KEY = 'chatbot_distill_progress'

function persistProgress(p: DistillProgress) {
  try {
    getDb().setMeta(P_KEY, JSON.stringify(p))
  } catch {
    /* 忽略 */
  }
}

/** 当前/最近一次蒸馏进度(内存优先;进程重启后残留的「运行中」视为已结束) */
export function distillProgress(): DistillProgress | null {
  if (activeJob) return activeJob
  const raw = getDb().getMeta(P_KEY)
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as DistillProgress
    if (j.running) j.running = false
    return j
  } catch {
    return null
  }
}

/** 启动后台蒸馏(已有任务在跑则拒绝);立即返回,进度见 distillProgress() */
export function startDistill(force: boolean): { started: boolean; reason?: string } {
  if (activeJob?.running) return { started: false, reason: '已有蒸馏任务在跑,请等它结束' }
  const p: DistillProgress = {
    running: true,
    force,
    total: 0,
    done: 0,
    ok: 0,
    ignored: 0,
    error: 0,
    current: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  activeJob = p
  persistProgress(p)
  void processCorpus(force, p)
    .catch(() => {})
    .finally(() => {
      p.running = false
      p.current = ''
      p.finishedAt = new Date().toISOString()
      persistProgress(p)
    })
  return { started: true }
}

/** 处理单个文件(行内改类别/放行/忽略后调用):只重跑这一个,不触发整库 */
export async function processFile(rel: string): Promise<CorpusStatusItem | null> {
  const cfg = getConfig()
  const db = getDb()
  const file = (await listCorpus()).find((f) => f.rel === rel)
  if (!file) return null
  const exempt = await publicContactExempt()
  const doc = db.getKbDoc(rel)
  const junk = junkReason(file.text)
  const nokeep = !!getJunkKeep()[rel]
  const base: CorpusStatusItem = {
    name: file.name,
    rel,
    size: file.text.length,
    sha: file.sha,
    kind: null,
    origin: originOf(rel, file.name, file.text),
    status: 'pending',
    error: '',
    fromDb: !!doc,
    junk: junk ? { auto: junk.auto, reason: junk.reason } : null,
    nokeep,
  }
  if (junk?.auto && !nokeep) {
    db.upsertKbDoc({ source: rel, kind: 'knowledge', title: file.name, size: file.text.length, sha: file.sha, status: 'ignored', error: `忽略:${junk.reason}` })
    if (doc) db.clearKbChunks(doc.id)
    base.status = 'ignored'
    base.error = `忽略:${junk.reason}`
    return base
  }
  const cleaned = await sanitizeFor(file, exempt)
  recordSanitized(rel, cleaned.hits)
  const cls = fastKind(rel, file.name, cleaned.text) ?? (await classifyGroup(cfg, [{ name: file.name, text: cleaned.text }])).map((r) => ({ kind: r.kind, title: r.title, origin: 'auto' as KindOrigin }))[0]
  base.kind = cls.kind
  base.origin = cls.origin
  try {
    const docId = db.upsertKbDoc({ source: rel, kind: cls.kind, title: cls.title, size: file.text.length, sha: file.sha, status: 'processed' })
    if (cls.kind === 'knowledge') await indexChunks(cfg, docId, rel, chunksOf(cleaned.text, cfg))
    else db.clearKbChunks(docId)
    base.status = 'processed'
    base.error = ''
    db.setMeta('chatbot_last_distill', `[${new Date().toISOString()}] ${file.name} → ${cls.kind} (${cls.origin})`)
  } catch (e) {
    db.upsertKbDoc({ source: rel, kind: cls.kind, title: file.name, size: file.text.length, sha: file.sha, status: 'error', error: String(e).slice(0, 300) })
    base.status = 'error'
    base.error = String(e).slice(0, 300)
  }
  return base
}

/** 全量/增量处理 corpus:垃圾过滤 → 脱敏 → (批量并发)分类 → 入库。进度写入 progress */
export async function processCorpus(force = false, progress?: DistillProgress): Promise<CorpusStatusItem[]> {
  const cfg = getConfig()
  const db = getDb()
  const exempt = await publicContactExempt()
  const corpus = await listCorpus()
  const result = new Map<string, CorpusStatusItem>()
  if (progress) progress.total = corpus.length

  interface Job {
    file: CorpusFile
    cleaned: { text: string; hits: SanHit[] }
    cls: { kind: CorpusKind; title: string; origin: KindOrigin } | null
    base: CorpusStatusItem
  }
  const todo: Job[] = []

  // Phase 1:垃圾过滤 + 跳过已完成 + 脱敏 + 确定性分类
  for (const file of corpus) {
    const doc = db.getKbDoc(file.rel)
    const done = !!doc && doc.status === 'processed' && doc.sha === file.sha
    const junk = junkReason(file.text)
    const nokeep = !!getJunkKeep()[file.rel]
    const base: CorpusStatusItem = {
      name: file.name,
      rel: file.rel,
      size: file.text.length,
      sha: file.sha,
      kind: doc?.status === 'error' ? null : (doc?.kind as CorpusKind | undefined) ?? null,
      origin: originOf(file.rel, file.name, file.text),
      status: doc?.error ? 'error' : done ? 'processed' : 'pending',
      error: doc?.error ?? '',
      fromDb: !!doc,
      junk: junk ? { auto: junk.auto, reason: junk.reason } : null,
      nokeep,
    }
    result.set(file.rel, base)
    // 自动垃圾过滤(类比脱敏,留盘可恢复):近空/无实词且未被「恢复入库」→ 标记 ignored 跳过
    if (junk?.auto && !nokeep) {
      db.upsertKbDoc({ source: file.rel, kind: 'knowledge', title: file.name, size: file.text.length, sha: file.sha, status: 'ignored', error: `忽略:${junk.reason}` })
      if (doc) db.clearKbChunks(doc.id)
      base.kind = null
      base.status = 'ignored'
      base.error = `忽略:${junk.reason}`
      if (progress) {
        progress.done++
        progress.ignored++
        progress.current = file.name
        persistProgress(progress)
      }
      continue
    }
    if (done && !force) {
      if (progress) {
        progress.done++
        persistProgress(progress)
      }
      continue
    }
    // 敏感信息脱敏:被放行则按原文,否则掩码后进入分类/切块/入库(磁盘原文件不动)
    const cleaned = await sanitizeFor(file, exempt)
    recordSanitized(file.rel, cleaned.hits)
    todo.push({ file, cleaned, cls: fastKind(file.rel, file.name, cleaned.text), base })
  }

  // Phase 2:LLM 批量分类(并发)
  const need = todo.filter((t) => !t.cls)
  const groups: Job[][] = []
  for (let i = 0; i < need.length; i += BATCH_SIZE) groups.push(need.slice(i, i + BATCH_SIZE))
  await mapLimit(groups, BATCH_CONC, async (g) => {
    const res = await classifyGroup(cfg, g.map((t) => ({ name: t.file.name, text: t.cleaned.text })))
    g.forEach((t, i) => {
      const r = res[i] ?? fallbackClassify(t.file.name)
      t.cls = { kind: r.kind, title: r.title, origin: 'auto' }
    })
  })

  // Phase 3:入库 + 切块/embedding(并发;写库为同步调用)
  await mapLimit(todo, COMMIT_CONC, async (t) => {
    const cls = t.cls!
    t.base.kind = cls.kind
    t.base.origin = cls.origin
    try {
      const docId = db.upsertKbDoc({ source: t.file.rel, kind: cls.kind, title: cls.title, size: t.file.text.length, sha: t.file.sha, status: 'processed' })
      if (cls.kind === 'knowledge') await indexChunks(cfg, docId, t.file.rel, chunksOf(t.cleaned.text, cfg))
      else db.clearKbChunks(docId)
      t.base.status = 'processed'
      t.base.error = ''
      db.setMeta('chatbot_last_distill', `[${new Date().toISOString()}] ${t.file.name} → ${cls.kind} (${cls.origin})`)
      if (progress) progress.ok++
    } catch (e) {
      db.upsertKbDoc({ source: t.file.rel, kind: cls.kind, title: t.file.name, size: t.file.text.length, sha: t.file.sha, status: 'error', error: String(e).slice(0, 300) })
      t.base.status = 'error'
      t.base.error = String(e).slice(0, 300)
      if (progress) progress.error++
    }
    if (progress) {
      progress.done++
      progress.current = t.file.name
      persistProgress(progress)
    }
  })

  // 对账:将 corpus/ 中已删除/更名的旧 doc 及其 chunks 一并清掉,让知识库严格镜像当前文件
  const current = new Set(corpus.map((f) => f.rel))
  for (const d of db.listKbDocs()) {
    if (!current.has(d.source)) db.deleteKbDoc(d.id)
  }
  return corpus.map((f) => result.get(f.rel)).filter((x): x is CorpusStatusItem => !!x)
}

/** 生成/刷新人格:取全部 persona 类 corpus + 现有 persona,交给 LLM 写 persona.md 与 faq.json */
export async function generatePersona(): Promise<{ persona: boolean; faq: number; note: string }> {
  const cfg = getConfig()
  const db = getDb()
  const { loadSoul } = await import('./soul')
  const soul = await loadSoul()

  const personaCorpus = (await listCorpus()).filter((f) => {
    const d = db.getKbDoc(f.rel)
    return d?.kind === 'persona' && d.status === 'processed'
  })
  // 人格素材同样先脱敏(被放行的文件按原文)
  const exempt = await publicContactExempt()
  const corpusText = (
    await Promise.all(
      personaCorpus.map(async (f) => {
        const c = await sanitizeFor(f, exempt)
        return `### ${f.name}\n${c.text}`
      }),
    )
  ).join('\n\n')

  const personaPrompt = [
    `你是帮刘子祥造一个"AI 分身灵魂"的写作助手。`,
    `读以下素材(真实的自述/随笔/经历),用第一人称写一份 persona.md:`,
    `- 概括:我是谁、做什么、性格、在乎什么、做事风格。`,
    `- 口吻:自然、克制、务实,不要"我热情开朗"这类空话;用具体的事/选择说明。`,
    `- 长度 300~600 字,Markdown 小标题。`,
    ``,
    `素材:`,
    corpusText || soul.persona || '(暂无素材,请写一份通用的自我介绍)',
  ].join('\n')

  const faqPrompt = [
    `基于以下 persona,给出访客最可能问的 6~10 个问题 + 简短回答(每答 ≤80 字),`,
    `输出一行 JSON 数组:{"q":"问题","a":"回答"}`,
    ``,
    soul.persona || corpusText,
  ].join('\n')

  const [persona, faqRaw] = await Promise.all([
    completeChat({
      protocol: chatProtocol(),
      baseUrl: cfg.chatBaseUrl,
      apiKey: getChatApiKey(),
      model: cfg.chatModel,
      messages: [{ role: 'user', content: personaPrompt }],
      temperature: 0.7,
      maxTokens: 3000,
      provider: cfg.chatProvider,
      sessionId: 'distill:persona',
      sanitize: true,
    }),
    completeChat({
      protocol: chatProtocol(),
      baseUrl: cfg.chatBaseUrl,
      apiKey: getChatApiKey(),
      model: cfg.chatModel,
      messages: [{ role: 'user', content: faqPrompt }],
      temperature: 0.3,
      maxTokens: 1200,
      provider: cfg.chatProvider,
      sessionId: 'distill:faq',
      sanitize: true,
    }),
  ])

  let faq: Array<{ q: string; a: string }> = []
  const m = faqRaw.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const j = JSON.parse(m[0]) as Array<{ q?: string; a?: string }>
      faq = j.filter((x) => x?.q && x.a).map((x) => ({ q: x.q!, a: x.a! })).slice(0, 12)
    } catch {
      /* faq 生成失败不阻断 */
    }
  }
  await writeSoulFiles(persona.trim(), faq)
  return { persona: true, faq: faq.length, note: `persona.md + ${faq.length} 条 FAQ 已写入 ${soulDir().root}` }
}

/** 清空整个知识库(docs + chunks + FTS) */
export function clearKb() {
  getDb().clearKb()
}

/** 汇总 admin 需要的状态 */
export async function distillStatus() {
  const db = getDb()
  const { loadSoul } = await import('./soul')
  const soul = await loadSoul()
  return {
    corpus: (await listCorpus()).map((f) => {
      const d = db.getKbDoc(f.rel)
      const junk = junkReason(f.text)
      return {
        name: f.name,
        rel: f.rel,
        size: f.text.length,
        sha: f.sha,
        kind: d?.kind ?? null,
        origin: originOf(f.rel, f.name, f.text),
        status: d?.status ?? 'pending',
        error: d?.error ?? '',
        junk: junk ? { auto: junk.auto, reason: junk.reason } : null,
        nokeep: !!getJunkKeep()[f.rel],
      }
    }),
    kindOverrides: getKindOverrides(),
    sensitiveAllowed: getSensitiveAllowed(),
    sanitized: getSanitizedMap(),
    docs: db.listKbDocs().map((d) => ({ source: d.source, kind: d.kind, status: d.status, size: d.size, error: d.error, sha: d.sha })),
    chunkCount: db.countKbChunks(),
    hasPersona: !!soul.persona,
    faqCount: soul.faq.length,
    progress: distillProgress(),
  }
}