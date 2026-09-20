import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { getDb } from './db'

export const ADMIN_COOKIE = 'zx_admin'
const META_KEY = 'admin_token'

export function newAdminToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

/** 是否已登录站长:cookie 与服务端随机 token 比对(登出即失效) */
export async function isAdmin(): Promise<boolean> {
  const store = await cookies()
  const v = store.get(ADMIN_COOKIE)?.value
  if (!v) return false
  const token = getDb().getMeta(META_KEY)
  return !!token && token === v
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  }
}
