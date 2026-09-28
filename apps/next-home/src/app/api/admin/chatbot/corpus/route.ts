// corpus 文件管理:admin 上传/删除「蒸馏原料」(仅 .md/.txt,写入 corpus/ 目录)。
// 上传成功后自动调用扫描蒸馏(分类+入库,不重新生成人格);删除时同步清掉对应知识块。
// 上传时对内容做敏感信息探测并提示(脱敏在蒸馏读取时生效,不改写磁盘原文件)。
import { isAdmin } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { startDistill, clearSensitiveFor } from '@/lib/chat/distill'
import { soulDir, publicContactExempt } from '@/lib/chat/soul'
import { detectSensitive, countHits } from '@/lib/chat/sanitize'
import { existsSync } from 'node:fs'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'

export const dynamic = 'force-dynamic'

const ALLOWED_EXT = /\.(md|txt)$/i
const MAX_BYTES = 2 * 1024 * 1024

/** 清洗文件名:只保留 basename 并去掉非法/控制字符,防路径穿越 */
function safeName(name: string): string {
  return path
    .basename(name)
    .replace(/[\x00-\x1f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
}

/** 解析 corpus 下的绝对路径;非法(空名/非 md|txt/越界)返回 null */
function corpusPath(name: string): string | null {
  const clean = safeName(name)
  if (!clean || !ALLOWED_EXT.test(clean)) return null
  const dir = path.resolve(soulDir().corpusDir)
  const full = path.resolve(dir, clean)
  return full.startsWith(dir + path.sep) ? full : null
}

export async function GET(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') ?? ''
  const full = corpusPath(name)
  if (!full) return Response.json({ ok: false, error: '无效文件名' }, { status: 400 })
  try {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(full, 'utf8')
    return Response.json({ ok: true, name: path.basename(full), size: Buffer.byteLength(text), text })
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
    return Response.json({ ok: false, error: missing ? '文件不存在' : String(e).slice(0, 200) }, { status: missing ? 404 : 500 })
  }
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const form = await req.formData()
    const files = [...form.values()].filter((v): v is File => v instanceof File)
    if (!files.length) return Response.json({ ok: false, error: '未收到文件' }, { status: 400 })

    const corpus = path.resolve(soulDir().corpusDir)
    await mkdir(corpus, { recursive: true })

    let exempt: string[] = []
    try {
      exempt = await publicContactExempt()
    } catch {
      exempt = []
    }
    const uploaded: Array<{ name: string; size: number; sanitized?: Array<{ label: string; n: number }> }> = []
    const errors: Array<{ name: string; error: string }> = []
    for (const f of files) {
      const full = corpusPath(f.name)
      if (!full) {
        errors.push({ name: f.name, error: '仅支持 .md / .txt' })
        continue
      }
      if (f.size > MAX_BYTES) {
        errors.push({ name: f.name, error: '超过 2MB 上限' })
        continue
      }
      const name = path.basename(full)
      if (existsSync(full)) {
        errors.push({ name, error: '文件已存在,请改名后上传或先删除旧文件' })
        continue
      }
      try {
        const buf = Buffer.from(await f.arrayBuffer())
        await writeFile(full, buf)
        const hits = detectSensitive(buf.toString('utf8'), exempt.length ? { exempt } : {})
        const counts = countHits(hits)
        const sanitized = Object.entries(counts).map(([label, n]) => ({ label, n }))
        uploaded.push({ name, size: buf.length, sanitized: sanitized.length ? sanitized : undefined })
      } catch (e) {
        errors.push({ name, error: String(e).slice(0, 200) })
      }
    }

    if (!uploaded.length) {
      const msg = errors.map((e) => `${e.name}: ${e.error}`).join('; ')
      return Response.json({ ok: false, error: msg || '没有可上传的文件' }, { status: 400 })
    }

    // 上传后后台扫描蒸馏(仅分类+入库;人格为「待生成」状态,由用户单独点「生成人格」)
    const job = startDistill(false)
    return Response.json({ ok: true, uploaded, errors, started: job.started })
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 300) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') ?? ''
  const full = corpusPath(name)
  if (!full) return Response.json({ ok: false, error: '无效文件名' }, { status: 400 })
  try {
    await unlink(full)
    // 同步清掉对应知识块(下一轮 distill 的「对账」本来也会清,这里即时生效)
    const rel = `corpus/${path.basename(full)}`
    const doc = getDb().getKbDoc(rel)
    if (doc) getDb().deleteKbDoc(doc.id)
    // 顺带清掉该文件的「放行/脱敏(kind 覆盖保留,便于重传恢复)」记录,避免残留
    clearSensitiveFor(rel)
    return Response.json({ ok: true, name: path.basename(full) })
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 })
  }
}