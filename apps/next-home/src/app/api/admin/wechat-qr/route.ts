import { isAdmin } from '@/lib/auth'
import { getWechatQr, setWechatQr } from '@/lib/settings'
import { readJson } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 800 * 1024

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const qr = getWechatQr()
  return Response.json({ hasQr: !!qr, ver: qr?.ver ?? null })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const data = await readJson<{ dataUrl?: string }>(req)
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data?.dataUrl ?? '')
  if (!m) {
    return Response.json({ error: '仅支持 PNG/JPEG/WebP 图片' }, { status: 400 })
  }
  const type = m[1]
  const base64 = m[2]
  const bytes = Math.floor((base64.length * 3) / 4)
  if (bytes > MAX_BYTES) {
    return Response.json({ error: '图片需 ≤ 800KB' }, { status: 400 })
  }

  setWechatQr(base64, type)
  const ver = getWechatQr()?.ver
  return Response.json({ ok: true, ver, url: `/api/contact/wechat-qr?v=${ver}` })
}
