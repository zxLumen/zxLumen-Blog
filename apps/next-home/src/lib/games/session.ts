import { cookies } from 'next/headers'
import type { GameCredentials } from './room-store'

const COOKIE_NAME = 'zx_game_session'
const MAX_AGE = 30 * 24 * 60 * 60

export interface StoredSession extends GameCredentials {
  code: string
}

function cookieDomain(): string | undefined {
  if (process.env.GAME_COOKIE_DOMAIN) return process.env.GAME_COOKIE_DOMAIN
  if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
    return `.${process.env.DOMAIN}`
  }
  return undefined
}

function encode(session: StoredSession): string {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
}

function decode(raw: string): StoredSession | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<StoredSession>
    if (
      typeof parsed.code === 'string' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return { code: parsed.code, playerId: parsed.playerId, token: parsed.token }
    }
  } catch {
    /* 坏的 cookie 当没有 */
  }
  return null
}

/** 读 HttpOnly 房间会话；原始 token 只在服务端出现，前端拿不到 */
export async function readCookieSession(): Promise<StoredSession | null> {
  const store = await cookies()
  const raw = store.get(COOKIE_NAME)?.value
  return raw ? decode(raw) : null
}

export async function setCookieSession(session: StoredSession): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, encode(session), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
    ...(cookieDomain() ? { domain: cookieDomain() } : {}),
  })
}

export async function clearCookieSession(): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    ...(cookieDomain() ? { domain: cookieDomain() } : {}),
  })
}

/**
 * API 鉴权：优先 cookie；同时保留 `x-game-player` / `x-game-token` 请求头，
 * 方便 curl / 自动化测试，不必先模拟浏览器 cookie jar。
 */
export async function credentialsFor(
  req: Request,
  code?: string,
): Promise<GameCredentials | null> {
  const session = await readCookieSession()
  if (session && (!code || session.code === code)) {
    return { playerId: session.playerId, token: session.token }
  }
  const playerId = req.headers.get('x-game-player')?.trim()
  const token = req.headers.get('x-game-token')?.trim()
  if (playerId && token) return { playerId, token }
  return null
}
