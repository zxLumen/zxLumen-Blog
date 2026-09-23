import fs from 'node:fs'
import path from 'node:path'
import { openDb, type Db } from '@zx/shared/server'

const g = globalThis as unknown as { __zxDb?: Db }

/** 全站唯一数据库(单环境) */
export function getDb(): Db {
  if (!g.__zxDb) {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'zx.db')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    g.__zxDb = openDb(dbPath)
  }
  return g.__zxDb
}

/** 环境变量回退密码:未配置则为空(此时若库中也无哈希,登录被禁用,不再默认弱密码) */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
export const REPORT_TOKEN = process.env.REPORT_TOKEN || 'dev-report-token'

/** 极简内存限流:每 IP 每分钟 N 次 */
const hits = new Map<string, number[]>()
export function rateLimit(ip: string, max = 6, windowMs = 60_000): boolean {
  const now = Date.now()
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= max) {
    hits.set(ip, arr)
    return false
  }
  arr.push(now)
  hits.set(ip, arr)
  return true
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  return xff?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
}
