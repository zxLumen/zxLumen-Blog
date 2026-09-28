// 敏感信息过滤(语料 → 蒸馏/问答的防线):
//   sanitizeText():把命中段替换为掩码,供蒸馏/加载知识时脱敏(不改写磁盘原文件)
//   detectSensitive():只探测,返回命中清单(供上传提示等)
// 两档检测:
//   hard —— 格式确定性高的凭证/证件/号码(身份证、银行卡、手机、密钥、连接串、内网IP…),命中即掩码
//   ctx  —— 关键词语境(亲属/出生/住址/密码),只掩码「关键词+跟随值」,降低误伤
// 纯函数、零依赖,便于用 node 直跑断言。(名称的格式面无法可靠检测,属已知边界)

export interface SanHit {
  group: 'hard' | 'ctx'
  label: string
}

export interface MaskResult {
  text: string
  hits: SanHit[]
}

export interface SanOpts {
  /** 豁免的精确完整值(如本站公开联系方式),命中值整串相等时跳过 */
  exempt?: string[]
}

/** 掩码占位(人格/知识文本里以中文占位,自然且不可逆) */
export const MASK = '×××'

/** 归一化联系方式:去空格/+/−/括号/连字符;再剥 +86/0086 国号(仅当剥后仍是 11 位 1[3-9] 手机),使「+86 156…」与裸号等价 */
function normContact(v: string): string {
  const n = v.toLowerCase().trim().replace(/[\s+()\u2212-]/g, '')
  return n.replace(/^(?:86|0086)(?=1[3-9]\d{9}$)/, '')
}

function isExempt(s: string, opts: SanOpts): boolean {
  const v = normContact(s)
  if (!v) return false
  return !!opts.exempt?.some((e) => e && normContact(e) === v)
}

/** Luhn 校验(银行卡号) */
export function luhn(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

interface Rule {
  group: 'hard' | 'ctx'
  label: string
  re: RegExp
  /** 校验回调:false 时跳过该命中 */
  test?: (m: string) => boolean
}

/* ---------- 硬检测(格式) ---------- */

const HARD_RULES: Rule[] = [
  {
    group: 'hard',
    label: 'SSH私钥',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    group: 'hard',
    label: '数据库/账号密码URL',
    re: /(?:https?|mongodb|mysql|postgres|postgresql|redis|rediss|amqp|ftp)s?:\/\/[^\s@/]+:[^@\s/]+@/g,
  },
  {
    group: 'hard',
    label: 'JWT令牌',
    re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    group: 'hard',
    label: 'API密钥',
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,})\b/g,
  },
  {
    group: 'hard',
    label: 'Bearer令牌',
    re: /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  },
  {
    group: 'hard',
    label: '通用密钥',
    re: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|auth[_-]?token|client[_-]?secret|access key|密钥|令牌)\b[：:="' \t]([A-Za-z0-9._-]{16,})/g,
    test: (m) => {
      const v = m.split(/[：:="' \t]/).pop() ?? ''
      return !/^secret-key$|^your-/i.test(v)
    },
  },
  {
    group: 'hard',
    label: '身份证',
    re: /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
  },
  { group: 'hard', label: '身份证(15位)', re: /(?<!\d)[1-9]\d{5}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}(?!\d)/g },
  {
    group: 'hard',
    label: '护照/通行证',
    re: /(?<![\w])[EGSHM]\d{7,8}(?![\w])/g,
  },
  {
    group: 'hard',
    label: '手机号',
    re: /(?<!\d)(?:1[3-9]\d{9}|1[3-9]\d{2}[- ]\d{4}[- ]\d{4})(?!\d)/g,
  },
  { group: 'hard', label: '座机/热线', re: /(?<!\d)(?:0\d{2,3}-?\d{7,8}|400-?\d{3}-?\d{4})(?!\d)/g },
  {
    group: 'hard',
    label: '邮箱',
    re: /(?<![\w.+-])[A-Za-z0-9][\w.+-]{0,62}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/g,
    test: (m) => !/example|@local\b|\bxx@|@\.|test@/i.test(m),
  },
  {
    group: 'hard',
    label: '内网IP',
    re: /(?<!\d)(?:10\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|192\.168\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d))(?!\d)/g,
  },
  {
    group: 'hard',
    label: '车牌号',
    re: /(?<![A-Z0-9])[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-Z0-9]{5}[挂学警港澳]?(?!\d)/g,
  },
]

/**
 * 银行卡 / 连续长数字:13 位以上纯数字串;
 * 优先 Luhn 校验判「银行卡」;非 Luhn 且 ≥16 位视为「连续长数字」兜底(排除全重复)。
 * 在 HARD_RULES(身份证等)之后运行,避免先吃掉身份证号导致标签错位。
 */
function maskCardNumbers(text: string, opts: SanOpts, hits: SanHit[]): string {
  const digitsRun = /(?<!\d)\d{13,}(?!\d)/g
  const spacedRun = /(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4,}(?!\d)/g
  const consume = (m: string): string => {
    const digits = m.replace(/[ -]/g, '')
    if (isExempt(digits, opts)) return m
    const label = luhn(digits) ? '银行卡' : digits.length >= 16 && !/^(\d)\1+$/.test(digits) ? '连续长数字' : null
    if (!label) return m
    hits.push({ group: 'hard', label })
    return MASK
  }
  let out = text.replace(digitsRun, consume)
  // 空格/连字符分隔的卡号(16–19 位),替换后再跑一次兜底
  out = out.replace(spacedRun, consume)
  return out
}

/**
 * GPS 坐标(仅同一行出现 纬度/经度/lat/lng/坐标 关键词时,掩码其数值对)
 */
function maskGps(text: string, opts: SanOpts, hits: SanHit[]): string {
  const KEY = /(纬度|经度|latitude|longitude|coordinate|坐标|GPS)/i
  const numRe = /-?\b\d{1,3}(?:\.\d{1,6})\b[\s,，、]+-?\d{1,3}(?:\.\d{1,6})\b/g
  return text
    .split('\n')
    .map((line) => {
      if (!KEY.test(line)) return line
      return line.replace(numRe, (m) => {
        if (isExempt(m.trim(), opts)) return m
        hits.push({ group: 'hard', label: 'GPS坐标' })
        return MASK
      })
    })
    .join('\n')
}

/* ---------- 语境检测(关键词+跟随值) ---------- */

const CTX_RULES: Rule[] = [
  {
    group: 'ctx',
    label: '亲属信息(含号码)',
    re: /(?:父亲|母亲|爸爸|妈妈|父母|爸妈|家父|家母|家属|家人|亲眷|祖父|祖母|外公|外婆|爷爷|奶奶|孙子|孙女|哥哥|姐姐|弟弟|妹妹|兄弟|姐妹|儿子|女儿)(?:的)?(?:手机|电话|身份证|身份证号|生日|出生|微信|QQ|号码)?[：:是于]?\s*\d{6,26}/g,
  },
  {
    group: 'ctx',
    label: '出生日期',
    re: /(?:出生|生日|生于|出生于|生辰)[于:：年月]?\s*(?:约)?\s*\d{4}[-\/年.]\d{1,2}[-\/月.]\d{1,2}[日号]?|\d{1,2}月\d{1,2}[日号]/g,
  },
  {
    group: 'ctx',
    label: '家庭住址',
    re: /(?:家庭住址|家庭地址|住址|家住|住在|小区)[:：]?\s*([^\n。!！?？;；]{2,40})/g,
    test: (m) => /号|区|村|小区|栋|幢|单元|室|镇|乡|路|街|巷|开发区|产业园|\d{4,}/.test(m),
  },
  {
    group: 'ctx',
    label: '密码口令',
    re: /(?:密码|口令|密钥|验证码|密保|access key|password)[为:：是]?\s*([A-Za-z0-9!@#$%^&*._-]{6,40})/g,
    test: (m) => {
      const v = m.split(/[为:：是]?\s*/).pop() ?? ''
      return !/^(password|secret|admin|root)$/i.test(v) && !/\s/.test(v)
    },
  },
]

/** 按规则序列掩码;dryRun 时不真的改文本(仅统计) */
function runAll(input: string, opts: SanOpts, mutate: boolean): { text: string; hits: SanHit[] } {
  let text = input
  const hits: SanHit[] = []

  const apply = (rules: Rule[]) => {
    for (const r of rules) {
      const rx = new RegExp(r.re.source, r.re.flags)
      if (mutate) {
        text = text.replace(rx, (m) => {
          if (isExempt(m.trim(), opts) || (r.test && !r.test(m))) return m
          hits.push({ group: r.group, label: r.label })
          return r.label === 'SSH私钥' ? '[SSH私钥已脱敏]' : MASK
        })
      } else {
        for (const m of text.matchAll(rx)) {
          const v = m[0]
          if (isExempt(v.trim(), opts) || (r.test && !r.test(v))) continue
          hits.push({ group: r.group, label: r.label })
        }
      }
    }
  }

  // 顺序:格式件(身份证/号码/密钥等)在前,避免卡号/长数字先吃掉身份证导致标签错位
  apply(HARD_RULES)
  if (mutate) text = maskCardNumbers(text, opts, hits)
  else maskCardNumbers(text, opts, hits)
  if (mutate) text = maskGps(text, opts, hits)
  else maskGps(text, opts, hits)
  apply(CTX_RULES)
  return { text, hits }
}

/** 脱敏:命中段替换为掩码(保留原文用于「放行」对照) */
export function sanitizeText(input: string, opts: SanOpts = {}): MaskResult {
  return runAll(input, opts, true)
}

/** 只探测命中(不掩码),供上传提示/面板计数 */
export function detectSensitive(input: string, opts: SanOpts = {}): SanHit[] {
  return runAll(input, opts, false).hits
}

/** 把命中清单按 label 汇总为 {label: count} */
export function countHits(hits: SanHit[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const h of hits) out[h.label] = (out[h.label] ?? 0) + 1
  return out
}