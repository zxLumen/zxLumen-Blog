import { randomInt } from 'node:crypto'
import { GameError } from './errors'

const PREFIX = ['微醺', '上头', '手气旺', '不服就开', '千杯不醉', '摇一摇', '夜猫子', '满上']
const SUFFIX = ['酒友', '骰子', '小酒仙', '杯中人', '桌边客', '干杯侠']

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  const chars = Array.from(cleaned)
  if (chars.length > 12) throw new GameError('昵称最多 12 个字')
  return chars.join('')
}

export function randomName(existing: string[]): string {
  const used = new Set(existing.map((name) => name.toLowerCase()))
  for (let i = 0; i < 40; i += 1) {
    const name = `${PREFIX[randomInt(0, PREFIX.length)]}${SUFFIX[randomInt(0, SUFFIX.length)]}`
    if (!used.has(name.toLowerCase())) return name
  }
  for (let n = 2; n < 100; n += 1) {
    const name = `酒友${n}号`
    if (!used.has(name.toLowerCase())) return name
  }
  return `酒友${randomInt(100, 999)}`
}

/** 空昵称 = 随机；填了就用填的，并拒绝重名 */
export function resolveName(raw: unknown, existing: string[]): string {
  const name = normalizeName(raw)
  if (!name) return randomName(existing)
  if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) {
    throw new GameError('这个昵称已经有人用了，换一个吧')
  }
  return name
}
