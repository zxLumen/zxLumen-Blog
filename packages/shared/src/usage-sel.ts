// 用量区块的筛选存档:经 cookie 随请求下发,服务端 SSR 首帧即可渲染正确状态,避免刷新闪跳

export const USAGE_SEL_COOKIE = 'zx_usage'

export type Range = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastmonth' | 'custom'
export type DataSource = 'deepseek' | 'opencode'

/** 时间区间 + 自定义日期(按数据源各自保存) */
export type RangeSel = {
  range: Range
  customStart: string
  customEnd: string
  customApplied: { start: string; end: string } | null
}

export type UsageSel = {
  dataSrc: DataSource
  /** 区间/自定义日期:每个数据源各自一套 */
  per: Record<DataSource, RangeSel>
  /** 模型筛选:每个数据源各自一套 */
  picked: Record<DataSource, string[]>
  /** Key/提供方筛选:每个数据源各自一套 */
  pickedKeys: Record<DataSource, string[]>
}

export const defaultRangeSel = (): RangeSel => ({
  range: '30d',
  customStart: '',
  customEnd: '',
  customApplied: null,
})

export const DEFAULT_SEL: UsageSel = {
  dataSrc: 'deepseek',
  per: { deepseek: defaultRangeSel(), opencode: defaultRangeSel() },
  picked: { deepseek: [], opencode: [] },
  pickedKeys: { deepseek: [], opencode: [] },
}

const RANGES_SET: readonly Range[] = ['today', 'yesterday', '7d', '30d', 'month', 'lastmonth', 'custom']
const SOURCES_SET: readonly DataSource[] = ['deepseek', 'opencode']

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** 兼容旧格式(单一数组)与新格式(按源分桶) */
const asBySrc = (v: unknown, dataSrc: DataSource): Record<DataSource, string[]> => {
  const out: Record<DataSource, string[]> = { deepseek: [], opencode: [] }
  if (Array.isArray(v)) {
    out[dataSrc] = asStringArray(v)
  } else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    out.deepseek = asStringArray(o.deepseek)
    out.opencode = asStringArray(o.opencode)
  }
  return out
}

const asRangeSel = (v: unknown): RangeSel => {
  if (!v || typeof v !== 'object') return defaultRangeSel()
  const o = v as Partial<RangeSel>
  return {
    range: RANGES_SET.includes(o.range as Range) ? (o.range as Range) : '30d',
    customStart: typeof o.customStart === 'string' ? o.customStart : '',
    customEnd: typeof o.customEnd === 'string' ? o.customEnd : '',
    customApplied:
      o.customApplied && typeof o.customApplied.start === 'string' && typeof o.customApplied.end === 'string'
        ? o.customApplied
        : null,
  }
}

/** 区间按源分桶;旧格式(顶层 range/custom*)迁移到当前 dataSrc 桶,另一源用默认 */
const asPer = (v: Partial<UsageSel> | null | undefined, dataSrc: DataSource): Record<DataSource, RangeSel> => {
  const out: Record<DataSource, RangeSel> = { deepseek: defaultRangeSel(), opencode: defaultRangeSel() }
  const raw = v?.per as Record<string, unknown> | undefined
  if (raw && typeof raw === 'object') {
    out.deepseek = asRangeSel(raw.deepseek)
    out.opencode = asRangeSel(raw.opencode)
    return out
  }
  // 旧格式:顶层 range/customStart/customEnd/customApplied → 归入当前源
  if (v && (v as { range?: unknown }).range !== undefined) {
    out[dataSrc] = asRangeSel({
      range: (v as { range?: unknown }).range as Range,
      customStart: (v as { customStart?: unknown }).customStart as string,
      customEnd: (v as { customEnd?: unknown }).customEnd as string,
      customApplied: (v as { customApplied?: unknown }).customApplied as RangeSel['customApplied'],
    })
  }
  return out
}

const asSel = (v: Partial<UsageSel> | null | undefined): UsageSel => {
  const dataSrc = v && SOURCES_SET.includes(v.dataSrc as DataSource) ? (v.dataSrc as DataSource) : DEFAULT_SEL.dataSrc
  return {
    dataSrc,
    per: asPer(v, dataSrc),
    picked: asBySrc(v?.picked, dataSrc),
    pickedKeys: asBySrc(v?.pickedKeys, dataSrc),
  }
}

/** 解析 cookie 存档(服务端/客户端通用);空值或非法一律回落默认 */
export const parseUsageSel = (raw: string | null | undefined): UsageSel => {
  if (!raw) return DEFAULT_SEL
  try {
    return asSel(JSON.parse(decodeURIComponent(raw)) as Partial<UsageSel>)
  } catch {
    return DEFAULT_SEL
  }
}

export const encodeUsageSel = (s: UsageSel): string => encodeURIComponent(JSON.stringify(s))

/** 客户端写入存档 cookie(path=/,一年有效) */
export const writeUsageSelCookie = (s: UsageSel): void => {
  try {
    document.cookie = `${USAGE_SEL_COOKIE}=${encodeUsageSel(s)}; path=/; max-age=31536000; SameSite=Lax`
  } catch {
    /* ignore */
  }
}
