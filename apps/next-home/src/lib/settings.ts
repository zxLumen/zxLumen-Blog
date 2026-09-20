import crypto from 'node:crypto'
import { PROFILE } from '@zx/shared'
import { ADMIN_PASSWORD, getDb } from './db'

export const ADMIN_NICK_KEY = 'admin_nick'
const ADMIN_PASS_KEY = 'admin_pass'

/** 站长昵称(存主库 meta,默认取 PROFILE.name) */
export function getAdminNick(): string {
  return getDb().getMeta(ADMIN_NICK_KEY) || PROFILE.name
}

export function setAdminNick(nick: string) {
  getDb().setMeta(ADMIN_NICK_KEY, nick)
}

/** 设置密码:scrypt 加盐哈希后存库 */
export function setAdminPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex')
  getDb().setMeta(ADMIN_PASS_KEY, `${salt}:${hash}`)
}

/** 校验密码:库里有哈希用哈希,否则回退到环境变量 ADMIN_PASSWORD */
export function verifyAdminPassword(pw: string): boolean {
  const stored = getDb().getMeta(ADMIN_PASS_KEY)
  if (!stored) return pw === ADMIN_PASSWORD
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const calc = crypto.scryptSync(pw, salt, 32).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(calc, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** 是否已通过网页设置过密码 */
export function hasCustomPassword(): boolean {
  return !!getDb().getMeta(ADMIN_PASS_KEY)
}
