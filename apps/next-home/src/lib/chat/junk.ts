// corpus 垃圾内容启发式检测:备忘录导出的碎屑(空文件 / 纯数字符号 / 极端短句)。
// 分两档:auto(自动跳过,不进知识库,留盘可恢复)与 hint(仅提示,不自动跳,避免误伤简短备忘)。

export interface JunkVerdict {
  /** true=自动跳过(近空 / 无实词);false=仅提示(太短) */
  auto: boolean
  reason: string
}

const WORD = /[\u4e00-\u9fffA-Za-z]/

/** 去掉 markdown 标题行、纯空行、分隔线后,剩下的正文文本 */
function bodyOf(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !/^#{1,6}\s?/.test(l) && l && !/^-{3,}$/.test(l))
    .join('\n')
}

/**
 * 判断一段 corpus 素材是否疑似垃圾。
 * - 近空:去标题/空行/分隔线后正文为空 → auto
 * - 无实词:正文全部非空行都不含中/英文词(纯数字、符号、乱码)→ auto
 * - 太短:正文 <10 字符但含中文词(购物清单、单项备忘)→ 仅提示,不自动跳
 */
export function junkReason(text: string): JunkVerdict | null {
  const body = bodyOf(text).trim()
  if (!body) return { auto: true, reason: '近空' }
  const lines = body.split('\n')
  if (lines.every((l) => !WORD.test(l))) return { auto: true, reason: '无实词' }
  if (body.length < 10) return { auto: false, reason: '太短' }
  return null
}