import { PROFILE } from '@zx/shared'
import { getDb } from './db'

export const ADMIN_NICK_KEY = 'admin_nick'

/** 站长昵称(存主库 meta,默认取 PROFILE.name) */
export function getAdminNick(): string {
  return getDb().getMeta(ADMIN_NICK_KEY) || PROFILE.name
}

export function setAdminNick(nick: string) {
  getDb().setMeta(ADMIN_NICK_KEY, nick)
}
