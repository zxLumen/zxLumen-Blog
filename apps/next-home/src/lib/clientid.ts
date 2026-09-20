import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'

/** 访客匿名 ID cookie:httpOnly,仅服务端可见,用于识别"本人"的私密/可删留言 */
export const CID_COOKIE = 'zx_cid'

export function cidCookie(cid: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${CID_COOKIE}=${cid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`
}

/** 读取当前请求的匿名 ID;没有则生成一个(用 isNew 决定是否下发 cookie) */
export async function resolveCid(): Promise<{ cid: string; isNew: boolean }> {
  const raw = (await cookies()).get(CID_COOKIE)?.value ?? ''
  if (raw) return { cid: raw, isNew: false }
  return { cid: randomBytes(16).toString('hex'), isNew: true }
}
