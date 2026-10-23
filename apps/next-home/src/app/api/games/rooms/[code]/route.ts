import { clearCookieSession, credentialsFor } from '@/lib/games/session'
import { gameErrorResponse, noStore } from '@/lib/games/http'
import { GameError } from '@/lib/games/errors'
import { getRoomView } from '@/lib/games/room-store'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params
  const credentials = await credentialsFor(req, code)
  if (!credentials) {
    return Response.json({ error: '没有房间会话，请重新加入' }, { status: 401 })
  }
  try {
    const { view } = getRoomView(code, credentials)
    return noStore(Response.json(view))
  } catch (error) {
    if (error instanceof GameError && (error.status === 401 || error.status === 404)) {
      await clearCookieSession()
    }
    return gameErrorResponse(error)
  }
}
