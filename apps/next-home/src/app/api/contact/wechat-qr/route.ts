import { getWechatQr } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const qr = await getWechatQr()
  if (!qr) return new Response('not found', { status: 404 })
  const bytes = Buffer.from(qr.base64, 'base64')
  return new Response(bytes, {
    headers: {
      'Content-Type': qr.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
