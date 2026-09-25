// 灵魂/知识文件热加载:读取 CHATBOT_DIR(默认仓库 docker/site-content/chatbot)下的
//   persona.md      人格(灵魂)——蒸馏产物,手工可改,每次问答都注入
//   faq.json        引导问题 + 范例问答(给模型 few-shot)
//   knowledge/*.md  站点/补充知识(回答时按需注入)
//   corpus/*.md|txt 原始文字(上传区,蒸馏后进入 persona 或知识库)
// 与 content-runtime.ts 相同的 mtime 缓存策略:改文件即生效,无需重启/重建。
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface SoulFaq {
  q: string
  a: string
}

export interface SoulFiles {
  persona: string
  faq: SoulFaq[]
  /** 每个知识文件的 { 相对名, 文本 } */
  knowledge: Array<{ source: string; text: string }>
}

export interface CorpusFile {
  name: string
  /** 相对 chatbot/ 的路径,如 corpus/随笔-01.md */
  rel: string
  text: string
  sha: string
}

export interface SoulDir {
  root: string
  persona: string
  faq: string
  knowledgeDir: string
  corpusDir: string
}

/** 解析 chatbot 目录:优先 CHATBOT_DIR,否则沿 cwd 向上找仓库默认位置 */
function resolveDir(): string {
  if (process.env.CHATBOT_DIR) return process.env.CHATBOT_DIR
  let dir = process.cwd()
  for (let i = 0; i < 4; i++) {
    const p = path.join(dir, 'docker', 'site-content', 'chatbot')
    if (existsSync(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(process.cwd(), 'chatbot')
}

export function soulDir(): SoulDir {
  const root = resolveDir()
  return {
    root,
    persona: path.join(root, 'persona.md'),
    faq: path.join(root, 'faq.json'),
    knowledgeDir: path.join(root, 'knowledge'),
    corpusDir: path.join(root, 'corpus'),
  }
}

let cache: { dir: string; persona: number; faq: number; data: SoulFiles } | null = null

/** 只读一次 mtime 快照;文件不存在返回 0 */
async function mtime(p: string): Promise<number> {
  try {
    const s = await stat(p)
    return s.mtimeMs
  } catch {
    return 0
  }
}

async function loadKnowledge(knowledgeDir: string): Promise<Array<{ source: string; text: string }>> {
  let files: string[] = []
  try {
    files = (await readdir(knowledgeDir)).filter((f) => /\.(md|txt)$/i.test(f))
  } catch {
    return []
  }
  files.sort()
  const out: Array<{ source: string; text: string }> = []
  for (const f of files) {
    try {
      const text = await readFile(path.join(knowledgeDir, f), 'utf8')
      out.push({ source: f, text })
    } catch {
      /* 跳过读不到的 */
    }
  }
  return out
}

/** 读取灵魂文件(带 mtime 缓存);缺文件用空值兜底,不抛错 */
export async function loadSoul(): Promise<SoulFiles> {
  const dir = soulDir()
  const personaM = await mtime(dir.persona)
  const faqM = await mtime(dir.faq)
  const knowledge = await loadKnowledge(dir.knowledgeDir)
  if (cache?.dir === dir.root && cache.persona === personaM && cache.faq === faqM) {
    return cache.data
  }
  const [personaRaw, faqRaw] = await Promise.all([
    readFile(dir.persona, 'utf8').catch(() => ''),
    readFile(dir.faq, 'utf8').catch(() => null),
  ])
  let faq: SoulFaq[] = []
  if (faqRaw) {
    try {
      const parsed = JSON.parse(faqRaw) as unknown
      if (Array.isArray(parsed)) {
        faq = parsed
          .filter((x): x is SoulFaq => !!x && typeof (x as SoulFaq).q === 'string')
          .slice(0, 20)
      }
    } catch {
      /* faq 非法则忽略 */
    }
  }
  const data: SoulFiles = { persona: personaRaw.trim(), faq, knowledge }
  cache = { dir: dir.root, persona: personaM, faq: faqM, data }
  return data
}

/** 列出 corpus 的待处理源文件(带 sha 供增量判定) */
export async function listCorpus(): Promise<CorpusFile[]> {
  const dir = soulDir()
  let files: string[] = []
  try {
    files = (await readdir(dir.corpusDir)).filter((f) => /\.(md|txt)$/i.test(f))
  } catch {
    return []
  }
  files.sort()
  const out: CorpusFile[] = []
  for (const f of files) {
    try {
      const text = await readFile(path.join(dir.corpusDir, f), 'utf8')
      out.push({
        name: f,
        rel: `corpus/${f}`,
        text,
        sha: crypto.createHash('sha1').update(text).digest('hex'),
      })
    } catch {
      /* 跳过 */
    }
  }
  return out
}

/** 写 persona.md / faq.json(蒸馏产物落盘,部署时随 site-content 热更新) */
export async function writeSoulFiles(persona: string, faq: SoulFaq[]): Promise<void> {
  const dir = soulDir()
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(dir.root, { recursive: true })
  if (persona) await writeFile(dir.persona, persona, 'utf8')
  await writeFile(path.join(dir.root, 'faq.json'), JSON.stringify(faq, null, 2), 'utf8')
  cache = null
}