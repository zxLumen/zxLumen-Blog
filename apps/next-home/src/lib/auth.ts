import crypto from 'node:crypto'
import { cookies } from 'next/headers'

export const ADMIN_COOKIE = 'zx_admin'
const MAX_AGE_S = 180 * 24 * 60 * 60 // 180 天

/**
 * 签名密钥:优先 SESSION_SECRET。
 * 生产环境**必须**显式配置 SESSION_SECRET,否则拒绝签发/校验会话(避免用可猜的兜底密钥伪造会话);
 * 非生产环境才允许回退到 ADMIN_PASSWORD / 开发兜底,便于本地调试。
 */
function secret(): string | null {
  const s = process.env.SESSION_SECRET
  if (s) return s
  if (process.env.NODE_ENV !== 'production') return process.env.ADMIN_PASSWORD || 'zx-dev-secret'
  return null
}

function sign(exp: number): string | null {
  const key = secret()
  if (!key) return null
  return crypto.createHmac('sha256', key).update(String(exp)).digest('hex')
}

/** 无状态会话:exp.签名,不依赖数据库;未配置 SESSION_SECRET(生产)时返回 null */
export function newAdminSession(): string | null {
  const exp = Date.now() + MAX_AGE_S * 1000
  const sig = sign(exp)
  if (!sig) return null
  return `${exp}.${sig}`
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
  if (!expected) return false
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
