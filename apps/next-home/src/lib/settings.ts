import crypto from 'node:crypto'
import { getRuntimeContent } from '@zx/shared/server'
import type { Contacts } from '@zx/shared'
import { ADMIN_PASSWORD, getDb } from './db'

export const ADMIN_NICK_KEY = 'admin_nick'
const ADMIN_PASS_KEY = 'admin_pass'
const K_EMAIL = 'contact_email'
const K_WECHAT = 'contact_wechat'
const K_PHONE = 'contact_phone'
const K_QR_DATA = 'wechat_qr_data'
const K_QR_TYPE = 'wechat_qr_type'
const K_QR_VER = 'wechat_qr_ver'

/** 微信二维码(存当前库 meta,base64) */
export async function getWechatQr(): Promise<{ base64: string; type: string; ver: string } | null> {
  const db = await getDb()
  const base64 = db.getMeta(K_QR_DATA)
  if (!base64) return null
  return {
    base64,
    type: db.getMeta(K_QR_TYPE) || 'image/png',
    ver: db.getMeta(K_QR_VER) || '0',
  }
}

export async function setWechatQr(base64: string, type: string) {
  const db = await getDb()
  db.setMeta(K_QR_DATA, base64)
  db.setMeta(K_QR_TYPE, type)
  db.setMeta(K_QR_VER, Date.now().toString(36))
}

const reverse = (s: string) => [...s].reverse().join('')

/** 联系方式(存当前库 meta,默认取运行时 content 的 CONTACTS);phone 为明文 */
export async function getContactSettings() {
  const db = await getDb()
  const { CONTACTS } = await getRuntimeContent()
  return {
    email: db.getMeta(K_EMAIL) ?? CONTACTS.email,
    wechat: db.getMeta(K_WECHAT) ?? CONTACTS.wechat ?? '',
    phone: db.getMeta(K_PHONE) ?? (CONTACTS.phoneReversed ? reverse(CONTACTS.phoneReversed) : ''),
  }
}

export async function setContactSettings(c: { email?: string; wechat?: string; phone?: string }) {
  const db = await getDb()
  if (c.email !== undefined) db.setMeta(K_EMAIL, c.email)
  if (c.wechat !== undefined) db.setMeta(K_WECHAT, c.wechat)
  if (c.phone !== undefined) db.setMeta(K_PHONE, c.phone)
}

/** 传给前端渲染用:只给 email/wechat 与"是否有电话"标记,不下发号码 */
export async function getClientContacts(): Promise<Contacts> {
  const { email, wechat, phone } = await getContactSettings()
  const qr = await getWechatQr()
  const { CONTACTS } = await getRuntimeContent()
  return {
    email,
    wechat: wechat || undefined,
    wechatQr: qr ? `/api/contact/wechat-qr?v=${qr.ver}` : CONTACTS.wechatQr,
    hasPhone: !!phone,
  }
}

/** 站长昵称(存当前库 meta,默认取运行时 content 的 PROFILE.name) */
export async function getAdminNick(): Promise<string> {
  const { PROFILE } = await getRuntimeContent()
  return (await getDb()).getMeta(ADMIN_NICK_KEY) || PROFILE.name
}

export async function setAdminNick(nick: string) {
  ;(await getDb()).setMeta(ADMIN_NICK_KEY, nick)
}

/**
 * 设置密码:scrypt 加盐哈希后存库。
 *
 * 注意:admin 密码是**全局身份**,固定存 `getDb()`(与站点数据同一库)。
 */
export function setAdminPassword(pw: string) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 32).toString('hex')
  getDb().setMeta(ADMIN_PASS_KEY, `${salt}:${hash}`)
}

/** 校验密码:库里有哈希用哈希,否则回退到环境变量 ADMIN_PASSWORD(仅线上库) */
export function verifyAdminPassword(pw: string): boolean {
  const stored = getDb().getMeta(ADMIN_PASS_KEY)
  // 库中无哈希时回退环境变量;若环境变量也未配置则一律拒绝(不默认弱密码)
  if (!stored) return !!ADMIN_PASSWORD && pw === ADMIN_PASSWORD
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const calc = crypto.scryptSync(pw, salt, 32).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(calc, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** 是否已通过网页设置过密码(线上库) */
export function hasCustomPassword(): boolean {
  return !!getDb().getMeta(ADMIN_PASS_KEY)
}
