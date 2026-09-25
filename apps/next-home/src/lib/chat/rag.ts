// 混合检索:FTS5 关键词 + embedding 余弦相似度(参考 RAG 项目 hybrid.py 的思路)。
// - 关键词检索永远可用(SQLite FTS5 内建)
// - 向量检索需要配置了 embedding provider;未配置时退化为纯关键词
import { getDb } from '../db'
import { embedReady, getConfig, getEmbedApiKey, embedProtocol } from './config'
import { embedTexts } from './llm'
import type { RetrievalHit } from './prompt'

/** 中文语法块 + 英文单词 → 候选检索词 */
export function extractKeywords(q: string): string[] {
  const tokens = q.match(/[\u4e00-\u9fff]+|[a-zA-Z0-9]+/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tokens.map((t) => t.toLowerCase())) {
    if (t.length < 2 || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out.slice(0, 8)
}

/** 解码 SQLite 存的 float32 LE BLOB → number[] */
export function decodeVector(buf: Buffer | Uint8Array): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

interface Candidate {
  content: string
  source: string
  score: number
}

/** 混合检索主入口:关键词检索永远跑;向量检索仅在配置了 embedding 时跑 */
export async function retrieve(question: string): Promise<RetrievalHit[]> {
  const cfg = getConfig()
  const topK = cfg.topK ?? 4
  if (!cfg.rag) return []
  const db = getDb()
  const hasDocs = db.hasKbChunks()
  if (!hasDocs) return []

  const picked: Candidate[] = []
  const seen = new Set<string>()

  // 1) 关键词召回(FTS5,永远可用)
  const keywords = extractKeywords(question)
  for (const k of keywords) {
    for (const r of db.ftsSearch(k, topK * 3)) {
      if (seen.has(r.content)) continue
      seen.add(r.content)
      picked.push({ content: r.content, source: r.source, score: 0.6 })
    }
    if (picked.length >= topK * 3) break
  }

  // 2) 向量召回(配置了 embedding 且模型可对齐向量维度时)
  if (embedReady()) {
    try {
      const qvec = await embedTexts({
        protocol: embedProtocol(),
        baseUrl: cfg.embedBaseUrl,
        apiKey: getEmbedApiKey(),
        model: cfg.embedModel,
        texts: [question],
      })
      const qv = qvec[0]
      if (qv?.length) {
        for (const r of db.listKbChunksWithVector()) {
          if (!r.vector) continue
          try {
            const v = decodeVector(r.vector)
            if (v.length !== qv.length) continue
            if (seen.has(r.content)) continue
            seen.add(r.content)
            picked.push({ content: r.content, source: r.source, score: Math.max(cosine(qv, v), 0) })
          } catch {
            /* 坏向量跳过 */
          }
        }
      }
    } catch {
      /* 向量失败不阻断关键词结果 */
    }
  }

  picked.sort((a, b) => b.score - a.score)

  const perFile = new Map<string, number>()
  const out: RetrievalHit[] = []
  for (const p of picked) {
    const n = perFile.get(p.source) ?? 0
    if (n >= 2) continue
    perFile.set(p.source, n + 1)
    out.push({ content: p.content, source: p.source })
    if (out.length >= topK) break
  }
  return out
}