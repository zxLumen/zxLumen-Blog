import { clientIp, rateLimit, readJson } from '@/lib/db'
import { gameErrorResponse, noStore } from '@/lib/games/http'
import { buildRoomView, joinGameRoom } from '@/lib/games/room-store'
import { setCookieSession } from '@/lib/games/session'

export const dynamic = 'force-dynamic'

interface Body {
  name?: string
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const ip = clientIp(req)
  if (!rateLimit(`game-join:${ip}`, 20, 60_000)) {
    return Response.json({ error: '加入太频繁了，歇一会儿再试' }, { status: 429 })
  }
  try {
    const { code } = await params
    const body = await readJson<Body>(req)
    const joined = joinGameRoom(code, body?.name)
    await setCookieSession({
      code: joined.room.code,
      playerId: joined.player.id,
      token: joined.token,
    })
    return noStore(
      Response.json({
        room: buildRoomView(joined.room, joined.player.id),
      }),
    )
  } catch (error) {
    return gameErrorResponse(error)
  }
}
