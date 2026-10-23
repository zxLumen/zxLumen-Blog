import { clientIp, rateLimit, readJson } from '@/lib/db'
import { clearCookieSession, credentialsFor } from '@/lib/games/session'
import { gameErrorResponse, noStore } from '@/lib/games/http'
import { GameError } from '@/lib/games/errors'
import { actRoom } from '@/lib/games/room-store'
import type { GameAction } from '@/lib/games/types'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const ip = clientIp(req)
  if (!rateLimit(`game-action:${ip}`, 240, 60_000)) {
    return Response.json({ error: '操作太频繁了，慢一点' }, { status: 429 })
  }
  const { code } = await params
  const credentials = await credentialsFor(req, code)
  if (!credentials) {
    return Response.json({ error: '没有房间会话，请重新加入' }, { status: 401 })
  }
  try {
    const body = await readJson<GameAction>(req)
    if (!body || typeof body.type !== 'string') {
      return Response.json({ error: '缺少操作类型' }, { status: 400 })
    }
    const { view } = actRoom(code, credentials, body)
    return noStore(Response.json(view))
  } catch (error) {
    if (error instanceof GameError && error.status === 401) {
      await clearCookieSession()
    }
    return gameErrorResponse(error)
  }
}
