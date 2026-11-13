// 问候语文本清洗(纯函数、零依赖):从模型输出里解析出可直接展示的句子。
// 单独成文件是为了能脱离 Next/DB 直接单测。
const PER_BUCKET = 10

/** 温度统一为「19°C」形式(℃ 单字形在等宽字体下会走回退、显示怪异) */
export function normalizeGreetingSymbols(s: string): string {
  return s.replace(/\s*℃\s*/g, '°C').replace(/(\d)\s*度/g, '$1°C')
}

/**
 * 去掉模型可能加的列表符号。
 * 关键:只认「1. / 1、 / (1) / - / •」这类真列表符,
 * 绝不吞掉行首数字 —— 否则「11月14日周六早上好」会被削成「月14日周六早上好」。
 */
function stripListMarker(s: string): string {
  return s
    .replace(/^[-*•·]\s*/, '')
    .replace(/^\d{1,2}[.、)）]\s*/, '')
    .replace(/^[（(]\d{1,2}[)）]\s*/, '')
    .replace(/^["“'‘]+/, '')
    .replace(/["”'’]+$/, '')
    .trim()
}

/** 解析模型输出为问候句列表 */
export function parseGreetingLines(text: string, limit = PER_BUCKET): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    let s = stripListMarker(raw.trim())
    s = normalizeGreetingSymbols(s)
    if (s.length < 6 || s.length > 120) continue
    if (/^(问候语|示例|输出|以下|好的|当然)/.test(s)) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

/** 旧解析器会把行首数字当列表符吃掉:识别「月14日…」「年11月…」这类残句 */
export function isMangledGreeting(s: string): boolean {
  return /^(月\d{1,2}日|年\d{1,2}月)/.test(s.trim())
}
