import { chatProtocol, getChatApiKey, getConfig } from '@/lib/chat/config'
import { completeChatFull, type ContentPart } from '@/lib/chat/llm'
import { defaultBaseUrl } from '@/lib/chat/providers'

/**
 * 视觉成对裁判的**共享实现** —— `/lab/judge`(验证实验)与 `/api/creatures/top`
 * 的 VLM 精排都走这里,保证「提示词、解析、模型选型」只有一处定义。
 *
 * 协议:给两张已渲染好的生物图(A、B),让视觉模型答「哪张更好看」。
 * 输出强制先写**具体视觉差异**再裁决(informativeness bias 的直接对策),
 * 结论只允许 【A】/【B】/【平局】。
 *
 * ⚠ 图片只能放 user 消息(system/assistant 带图会 400);只对支持视觉的模型调用。
 */

export type Verdict = 'A' | 'B' | '平局'

export const JUDGE_SYSTEM = `你是一位视觉审美评委。用户会给你两张生物插画(A 和 B),你要判断哪一张**看起来更好看**。

规则:
- 只评判**审美观感**:构图、配色和谐、形体完整度、有没有记忆点、有没有明显的视觉缺陷(比如糊成一团、颜色刺眼、比例失衡)。
- **不要**因为「更复杂 / 部件更多 / 更花哨」就认为更好看。简洁而整洁,可以胜过繁复而杂乱。
- **先写一句「两张图的具体视觉差异」**(必须落到图上真实存在的东西,不要空话),再给结论。
- 结论只能是这三个之一,单独一行:【A】【B】【平局】

输出格式(严格遵守):
差异:<一句话,说出你在图里实际看到的区别>
结论:【A】 或 【B】 或 【平局】`

/** 把两张图 + 指引拼成**一条** user 消息(图片必须与文字同一条 user 消息) */
export function judgeUserMessage(a: string, b: string): ContentPart[] {
  return [
    { type: 'text', text: '下面依次是图 A 和图 B。请按规则评判,先写差异,再给结论。' },
    { type: 'text', text: '图 A:' },
    { type: 'image_url', image_url: { url: a, detail: 'low' } },
    { type: 'text', text: '图 B:' },
    { type: 'image_url', image_url: { url: b, detail: 'low' } },
  ]
}

/** 从模型回复里解析裁决。宽容处理:优先看【A】/【B】/平局标记 */
export function parseVerdict(text: string): { verdict: Verdict | null; reason: string } {
  const reason = text.match(/差异[:：]\s*(.+)/)?.[1]?.trim() ?? ''
  const m = text.match(/【\s*(A|B|平局)\s*】/i)
  if (m) {
    const v = m[1]!.toUpperCase()
    return { verdict: v === 'A' || v === 'B' ? (v as Verdict) : '平局', reason }
  }
  // 兜底:没有标记时,看整段里哪个词先出现(次序即偏好)
  const tail = text.slice(-80)
  const ai = tail.lastIndexOf('A')
  const bi = tail.lastIndexOf('B')
  const tie = tail.lastIndexOf('平局')
  if (tie >= 0 && tie > ai && tie > bi) return { verdict: '平局', reason }
  if (ai >= 0 || bi >= 0) return { verdict: ai > bi ? 'A' : 'B', reason }
  return { verdict: null, reason }
}

export interface JudgePairResult {
  verdict: Verdict | null
  reason: string
  ms: number
  inTokens?: number
  outTokens?: number
  finishReason?: string
  raw: string
}

/**
 * 问一次「第一张 vs 第二张」,返回裁决。**不抛错**,失败时 `verdict=null`、`raw` 带原因,
 * 让调用方决定降级(精排失败退回 heur 排名,而不是把整榜拖崩)。
 */
export async function judgePair(firstPng: string, secondPng: string): Promise<JudgePairResult> {
  const started = Date.now()
  const cfg = getConfig()
  const baseUrl = cfg.chatBaseUrl || defaultBaseUrl(cfg.chatProvider)
  const apiKey = getChatApiKey()
  if (!apiKey) return { verdict: null, reason: '', ms: 0, raw: '未配置模型 API Key(admin → 机器人)' }
  if (!/^https?:\/\//.test(baseUrl)) return { verdict: null, reason: '', ms: 0, raw: '模型端点未配置' }

  try {
    const res = await completeChatFull({
      protocol: chatProtocol(),
      baseUrl,
      apiKey,
      model: cfg.chatModel || 'deepseek-v4.1-flash',
      provider: cfg.chatProvider,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: judgeUserMessage(firstPng, secondPng) },
      ],
      temperature: 0,
      // 思维链 + 差异 + 结论,给足;截断会让裁决解析不到
      maxTokens: 900,
    })
    const { verdict, reason } = parseVerdict(res.text)
    return {
      verdict,
      reason,
      ms: Date.now() - started,
      inTokens: res.inTokens,
      outTokens: res.outTokens,
      finishReason: res.finishReason,
      raw: res.text,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '裁判调用失败'
    return { verdict: null, reason: '', ms: Date.now() - started, raw: msg }
  }
}
