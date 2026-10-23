import { clearCookieSession, readCookieSession } from '@/lib/games/session'
import { noStore } from '@/lib/games/http'
import { getRoomView } from '@/lib/games/room-store'

export const dynamic = 'force-dynamic'

/** 浏览器重新打开时凭 HttpOnly cookie 自动回到上一局 */
export async function GET() {
  const session = await readCookieSession()
  if (!session) return noStore(Response.json({ room: null }))
  try {
    const { view } = getRoomView(session.code, {
      playerId: session.playerId,
      token: session.token,
    })
    return noStore(Response.json({ room: view }))
  } catch {
    await clearCookieSession()
    return noStore(Response.json({ room: null }))
  }
}
