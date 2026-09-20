import crypto from 'node:crypto'
import { CONTACTS, PROFILE } from '@zx/shared'
import type { Contacts } from '@zx/shared'
import { ADMIN_PASSWORD, getDb } from './db'

export const ADMIN_NICK_KEY = 'admin_nick'
const ADMIN_PASS_KEY = 'admin_pass'
const K_EMAIL = 'contact_email'
const K_WECHAT = 'contact_wechat'
const K_PHONE = 'contact_phone'

const reverse = (s: string) => [...s].reverse().join('')

/** 联系方式(存主库 meta,默认取 shared 的 CONTACTS);phone 为明文 */
export function getContactSettings() {
  const db = getDb()
  return {
    email: db.getMeta(K_EMAIL) ?? CONTACTS.email,
    wechat: db.getMeta(K_WECHAT) ?? CONTACTS.wechat ?? '',
    phone: db.getMeta(K_PHONE) ?? (CONTACTS.phoneReversed ? reverse(CONTACTS.phoneReversed) : ''),
  }
}

export function setContactSettings(c: { email?: string; wechat?: string; phone?: string }) {
  const db = getDb()
  if (c.email !== undefined) db.setMeta(K_EMAIL, c.email)
  if (c.wechat !== undefined) db.setMeta(K_WECHAT, c.wechat)
  if (c.phone !== undefined) db.setMeta(K_PHONE, c.phone)
}

/** 传给前端渲染用:只给 email/wechat 与"是否有电话"标记,不下发号码 */
export function getClientContacts(): Contacts {
  const { email, wechat, phone } = getContactSettings()
  return {
    email,
    wechat: wechat || undefined,
    hasPhone: !!phone,
  }
}

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
