import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { isTestMode } from './env'

/** 访客匿名 ID cookie:httpOnly,仅服务端可见,用于识别"本人"的私密/可删留言 */
export const CID_COOKIE = 'zx_cid'
/** 模拟访客 ID cookie:仅测试模式 + 站长生效,用于以他人身份浏览 */
export const MOCK_COOKIE = 'zx_mock'

export function cidCookie(cid: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${CID_COOKIE}=${cid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`
}

/** 测试模式(需站长)下设置的模拟访客 ID,否则空 */
async function mockCid(): Promise<string> {
  if (!(await isTestMode())) return ''
  return (await cookies()).get(MOCK_COOKIE)?.value ?? ''
}

/** 是否正处于"模拟访客"状态(仅测试模式 + 站长) */
export async function isMockActive(): Promise<boolean> {
  return (await mockCid()) !== ''
}

/** 当前"查看者"的匿名 ID(测试模式下可被 mock 覆盖);无则返回 '' */
export async function effectiveCid(): Promise<string> {
  const mock = await mockCid()
  if (mock) return mock
  return (await cookies()).get(CID_COOKIE)?.value ?? ''
}

/** 读取当前请求的匿名 ID;没有则生成一个(用 isNew 决定是否下发 cookie) */
export async function resolveCid(): Promise<{ cid: string; isNew: boolean }> {
  const mock = await mockCid()
  if (mock) return { cid: mock, isNew: false }
  const raw = (await cookies()).get(CID_COOKIE)?.value ?? ''
  if (raw) return { cid: raw, isNew: false }
  return { cid: randomBytes(16).toString('hex'), isNew: true }
}
