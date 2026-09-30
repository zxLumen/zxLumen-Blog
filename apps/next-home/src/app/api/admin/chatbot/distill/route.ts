import { isAdmin } from '@/lib/auth'
import { readJson } from '@/lib/db'
import {
  cancelJob,
  clearKb,
  distillStatus,
  processFile,
  setJunkKeep,
  setKindOverride,
  setSensitiveAllowed,
  startDistill,
  startPersona,
} from '@/lib/chat/distill'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return Response.json({ ok: true, ...(await distillStatus()) })
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

interface Body {
  action?: 'process' | 'persona' | 'clear' | 'cancel' | 'set-kind' | 'set-sensitive-allow' | 'set-ignored'
  force?: boolean
  /** set-kind:corpus 相对路径 */
  source?: string
  /** set-kind:persona | knowledge | auto(恢复自动) */
  kind?: 'persona' | 'knowledge' | 'auto'
  /** set-sensitive-allow:true=放行(按原文),false=恢复脱敏 */
  allow?: boolean
  /** set-ignored:true=保持自动过滤(忽略),false=恢复入库(豁免) */
  ignore?: boolean
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const body = await readJson<Body>(req)
  const action = body?.action ?? 'process'
  try {
    if (action === 'process') {
      // 后台跑批,立即返回;进度通过 GET distillStatus().progress 轮询
      const r = startDistill(!!body?.force)
      return Response.json({ ok: true, action, ...r })
    }
    if (action === 'set-kind') {
      const source = (body?.source ?? '').trim()
      const kind = body?.kind
      if (!source || (kind !== 'persona' && kind !== 'knowledge' && kind !== 'auto')) {
        return Response.json({ ok: false, error: '参数无效' }, { status: 400 })
      }
      setKindOverride(source, kind)
      const item = await processFile(source)
      return Response.json({ ok: true, action, item })
    }
    if (action === 'set-sensitive-allow') {
      const source = (body?.source ?? '').trim()
      if (!source) return Response.json({ ok: false, error: '参数无效' }, { status: 400 })
      setSensitiveAllowed(source, !!body?.allow)
      const item = await processFile(source)
      return Response.json({ ok: true, action, allow: !!body?.allow, item })
    }
    if (action === 'set-ignored') {
      const source = (body?.source ?? '').trim()
      if (!source) return Response.json({ ok: false, error: '参数无效' }, { status: 400 })
      setJunkKeep(source, body?.ignore ? false : true)
      const item = await processFile(source)
      return Response.json({ ok: true, action, ignore: !!body?.ignore, item })
    }
    if (action === 'persona') {
      // 后台生成,立即返回;状态通过 GET 的 persona 轮询
      const r = startPersona()
      return Response.json({ ok: true, action, ...r })
    }
    if (action === 'cancel') {
      const r = cancelJob()
      return Response.json({ ok: true, action, ...r })
    }
    if (action === 'clear') {
      clearKb()
      return Response.json({ ok: true, action })
    }
    return Response.json({ ok: false, error: '未知 action' }, { status: 400 })
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 300) }, { status: 500 })
  }
}