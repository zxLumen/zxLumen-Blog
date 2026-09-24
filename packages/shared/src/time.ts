/** 当前 UTC 时间 YYYY-MM-DD HH:mm:ss */
export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

/** 北京时(UTC+8)日期 YYYY-MM-DD */
export const bjDay = (t = Date.now()) => new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10)

/** 将 UTC ts 转北京时间 MM-DD HH:mm */
export const bjTime = (utc: string) => {
  const d = new Date(new Date(utc.replace(' ', 'T') + 'Z').getTime() + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** 将 UTC ts 转北京时间 MM-DD HH:mm:ss(访客明细流水用) */
export const bjTimeSec = (utc: string) => {
  const d = new Date(new Date(utc.replace(' ', 'T') + 'Z').getTime() + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** UTC ts 字符串 → 毫秒时间戳 */
export const tsMs = (utc: string) => new Date(utc.replace(' ', 'T') + 'Z').getTime()
