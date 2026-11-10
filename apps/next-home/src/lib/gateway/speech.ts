// AI 网关·语音合成适配器。
//
// 目前只支持 OpenAI 兼容的 `POST {baseUrl}/audio/speech`(SiliconFlow CosyVoice2 /
// MOSS-TTSD 等)。上游返回整段 mp3,网关只做鉴权/路由/计量,然后把字节流原样透传,
// 不落内存(客户端可以边下边缓存;真流式要等上游支持 chunked PCM)。
//
// 声音写法两种都收:
//   voice = "anna"                        → 自动补成 "<model>:anna"(SiliconFlow 的要求)
//   voice = "FunAudioLLM/CosyVoice2-0.5B:anna" → 原样透传

import type { GatewayProvider } from '@/lib/ai-gateway'

export interface SpeechInput {
  text: string
  voice?: string
  model?: string
  speed?: number
  format?: string
}

/** SiliconFlow 要求 `模型:音色`;面板里只填音色时补上前缀。 */
export function normalizeVoice(voice: string, model: string): string {
  const v = (voice || '').trim()
  if (!v) return ''
  if (v.includes(':')) return v
  return model ? `${model}:${v}` : v
}

/** 粗略估算音频秒数(中文约 4.5 字/秒),用于按音频分钟限额;仅为计量,不精确。 */
export function estimateSpeechSeconds(text: string, speed = 1): number {
  const chars = (text || '').replace(/\s+/g, '').length
  const sp = Math.min(1.3, Math.max(0.7, Number(speed) || 1))
  return Math.min(300, Math.round((chars / 4.5 / sp) * 10) / 10)
}

export async function synthesizeSpeech(
  provider: GatewayProvider,
  input: SpeechInput,
  signal?: AbortSignal,
): Promise<Response> {
  const model = input.model || provider.model || ''
  const voice = normalizeVoice(input.voice || '', model)
  const body: Record<string, unknown> = {
    model,
    input: input.text,
    response_format: input.format || 'mp3',
  }
  if (voice) body.voice = voice
  if (input.speed) body.speed = Math.min(1.3, Math.max(0.7, Number(input.speed)))

  return fetch(`${provider.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
}
