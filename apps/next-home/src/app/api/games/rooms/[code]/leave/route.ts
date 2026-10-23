import { clearCookieSession, credentialsFor } from '@/lib/games/session'
import { gameErrorResponse, noStore } from '@/lib/games/http'
import { leaveRoom } from '@/lib/games/room-store'

export const dynamic = 'force-dynamic'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params
  const credentials = await credentialsFor(req, code)
  try {
    if (credentials) leaveRoom(code, credentials)
    await clearCookieSession()
    return noStore(Response.json({ ok: true }))
  } catch (error) {
    await clearCookieSession()
    return gameErrorResponse(error)
  }
}
