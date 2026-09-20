import crypto from 'node:crypto'
import { cookies } from 'next/headers'

export const ADMIN_COOKIE = 'zx_admin'
const MAX_AGE_S = 180 * 24 * 60 * 60 // 180 天

/** 签名密钥:优先 SESSION_SECRET,其次 ADMIN_PASSWORD,最后开发兜底 */
function secret(): string {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'zx-dev-secret'
}

function sign(exp: number): string {
  return crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex')
}

/** 无状态会话:exp.签名,不依赖数据库 */
export function newAdminSession(): string {
  const exp = Date.now() + MAX_AGE_S * 1000
  return `${exp}.${sign(exp)}`
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies()
  const v = store.get(ADMIN_COOKIE)?.value
  if (!v) return false
  const idx = v.indexOf('.')
  if (idx < 1) return false
  const exp = Number(v.slice(0, idx))
  const sig = v.slice(idx + 1)
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false
  const expected = sign(exp)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE_S,
    secure: process.env.NODE_ENV === 'production',
  }
}
