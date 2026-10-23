import { clientIp, rateLimit, readJson } from '@/lib/db'
import { isGameId } from '@/lib/games/catalog'
import { gameErrorResponse, noStore } from '@/lib/games/http'
import { buildRoomView, createGameRoom } from '@/lib/games/room-store'
import { setCookieSession } from '@/lib/games/session'

export const dynamic = 'force-dynamic'

interface Body {
  game?: string
  name?: string
}

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!rateLimit(`game-create:${ip}`, 12, 60_000)) {
    return Response.json({ error: '开房太频繁了，歇一会儿再试' }, { status: 429 })
  }
  try {
    const body = await readJson<Body>(req)
    const game = (body?.game ?? '').trim()
    if (!isGameId(game)) return Response.json({ error: '未知游戏' }, { status: 400 })
    const created = createGameRoom(game, body?.name)
    await setCookieSession({
      code: created.room.code,
      playerId: created.player.id,
      token: created.token,
    })
    return noStore(
      Response.json({
        room: buildRoomView(created.room, created.player.id),
      }),
    )
  } catch (error) {
    return gameErrorResponse(error)
  }
}
