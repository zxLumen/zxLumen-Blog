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
import { listCorpus, writeSoulFiles, soulDir } from './soul'

export interface CorpusStatusItem {
  name: string
  rel: string
  size: number
  sha: string
  kind: 'persona' | 'knowledge' | null
  status: 'pending' | 'processed' | 'error'
  error: string
  fromDb: boolean
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

/** 用 LLM 判断某段文字该进"人格"还是"知识库" */
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

  const raw = await completeChat({
    protocol: chatProtocol(),
    baseUrl: cfg.chatBaseUrl,
    apiKey: getChatApiKey(),
    model: cfg.chatModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    maxTokens: 200,
  })
  const m = raw.match(/\{[\s\S]*?\}/)
  if (!m) throw new Error('LLM 未返回 JSON')
  const j = JSON.parse(m[0]) as { kind?: string; title?: string; note?: string }
  const kind = j.kind === 'knowledge' ? 'knowledge' : 'persona'
  return { kind, title: j.title || name, note: j.note || '' }
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

/** 全量/增量处理 corpus:分类 → 知识别入库。返回每文件的处理结果 */
export async function processCorpus(force = false): Promise<CorpusStatusItem[]> {
  const cfg = getConfig()
  const db = getDb()
  const corpus = await listCorpus()
  const out: CorpusStatusItem[] = []
  for (const file of corpus) {
    const doc = db.getKbDoc(file.rel)
    const done = doc && doc.status === 'processed' && doc.sha === file.sha
    const base: CorpusStatusItem = {
      name: file.name,
      rel: file.rel,
      size: file.text.length,
      sha: file.sha,
      kind: doc?.status === 'error' ? null : (doc?.kind as 'persona' | 'knowledge' | undefined) ?? null,
      status: doc?.error ? 'error' : done ? 'processed' : 'pending',
      error: doc?.error ?? '',
      fromDb: !!doc,
    }
    if (done && !force) {
      out.push(base)
      continue
    }
    try {
      const cls = await classifyText(cfg, file.name, file.text)
      base.kind = cls.kind
      const docId = db.upsertKbDoc({
        source: file.rel,
        kind: cls.kind,
        title: cls.title,
        size: file.text.length,
        sha: file.sha,
        status: 'processed',
      })
      if (cls.kind === 'knowledge') {
        await indexChunks(cfg, docId, file.rel, chunksOf(file.text, cfg))
      } else {
        db.clearKbChunks(docId)
      }
      base.status = 'processed'
      base.error = ''
      db.setMeta('chatbot_last_distill', `[${new Date().toISOString()}] ${file.name} → ${cls.kind}`)
    } catch (e) {
      db.upsertKbDoc({
        source: file.rel,
        kind: base.kind ?? 'knowledge',
        title: file.name,
        size: file.text.length,
        sha: file.sha,
        status: 'error',
        error: String(e).slice(0, 300),
      })
      base.status = 'error'
      base.error = String(e).slice(0, 300)
    }
    out.push(base)
  }
  // 对账:将 corpus/ 中已删除/更名的旧 doc 及其 chunks 一并清掉,让知识库严格镜像当前文件
  const current = new Set(corpus.map((f) => f.rel))
  for (const d of db.listKbDocs()) {
    if (!current.has(d.source)) db.deleteKbDoc(d.id)
  }
  return out
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
  const corpusText = personaCorpus.map((f) => `### ${f.name}\n${f.text}`).join('\n\n')

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
      maxTokens: 1500,
    }),
    completeChat({
      protocol: chatProtocol(),
      baseUrl: cfg.chatBaseUrl,
      apiKey: getChatApiKey(),
      model: cfg.chatModel,
      messages: [{ role: 'user', content: faqPrompt }],
      temperature: 0.3,
      maxTokens: 600,
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
      return {
        name: f.name,
        rel: f.rel,
        size: f.text.length,
        sha: f.sha,
        kind: d?.kind ?? null,
        status: d?.status ?? 'pending',
        error: d?.error ?? '',
      }
    }),
    docs: db.listKbDocs().map((d) => ({ source: d.source, kind: d.kind, status: d.status, size: d.size, error: d.error, sha: d.sha })),
    chunkCount: db.countKbChunks(),
    hasPersona: !!soul.persona,
    faqCount: soul.faq.length,
  }
}