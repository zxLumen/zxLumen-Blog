// AI 网关·音频转写适配器:把不同上游(OpenAI 兼容 / Deepgram / AssemblyAI)归一化成
// 统一形状,供子应用(如「无恙」)无差别调用。
//
// 统一返回:
//   { text: string, language?: string, segments: { start, end, speaker, text }[], seconds: number }
//   - speaker 为 null 表示未做说话人分离(单人转写)。
//
// 三类上游形状:
//   openai     : POST {baseUrl}/audio/transcriptions (multipart), response_format=verbose_json
//   deepgram   : POST {baseUrl}/v1/listen (音频二进制), diarize_model 开启分离
//   assemblyai : POST {baseUrl}/v2/upload → /v2/transcript → 轮询

import type { GatewayProvider } from '@/lib/ai-gateway'

export interface AudioSegment {
  start: number
  end: number
  speaker: string | null
  text: string
}

export interface NormalizedTranscript {
  text: string
  language?: string
  segments: AudioSegment[]
  /** 音频时长(秒),用于用量统计 */
  seconds: number
}

export interface AudioInput {
  bytes: Uint8Array
  filename: string
  contentType: string
  language?: string
  /** 请求方是否要求说话人分离 */
  diarize: boolean
  /** 覆盖请求的模型(可选) */
  model?: string
}

const num = (v: unknown, d = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await p(ac.signal)
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------ OpenAI 兼容 ------------------------------ */
async function transcribeOpenAI(provider: GatewayProvider, input: AudioInput): Promise<NormalizedTranscript> {
  const model = input.model || provider.model || 'whisper-1'
  const form = new FormData()
  form.set('file', new Blob([input.bytes as unknown as BlobPart], { type: input.contentType }), input.filename)
  form.set('model', model)
  form.set('response_format', 'verbose_json')
  if (input.language) form.set('language', input.language)

  const res = await withTimeout(
    (signal) =>
      fetch(`${provider.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${provider.apiKey}` },
        body: form,
        signal,
      }),
    300_000,
  )
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`openai 转写失败 ${res.status}:${t.slice(0, 200)}`)
  }
  const j = (await res.json()) as Record<string, unknown>
  const segs = Array.isArray(j.segments) ? (j.segments as Record<string, unknown>[]) : []
  const segments: AudioSegment[] = segs.map((s) => ({
    start: num(s.start),
    end: num(s.end),
    speaker: null,
    text: typeof s.text === 'string' ? s.text : '',
  }))
  const text = typeof j.text === 'string' ? j.text : segments.map((s) => s.text).join('')
  const seconds = num(j.duration) || segments.reduce((a, s) => Math.max(a, s.end), 0)
  return { text, language: typeof j.language === 'string' ? j.language : input.language, segments, seconds }
}

/* ------------------------------ Deepgram ------------------------------ */
interface DgWord {
  word?: string
  punctuated_word?: string
  start?: number
  end?: number
  speaker?: number
}
interface DgUtterance {
  start?: number
  end?: number
  transcript?: string
  speaker?: number
}
async function transcribeDeepgram(provider: GatewayProvider, input: AudioInput): Promise<NormalizedTranscript> {
  const model = input.model || provider.model || 'nova-3'
  const qs = new URLSearchParams({ model, punctuate: 'true', smart_format: 'true', utterances: 'true' })
  if (input.diarize) qs.set('diarize_model', 'latest')
  if (input.language) qs.set('language', input.language)

  const res = await withTimeout(
    (signal) =>
      fetch(`${provider.baseUrl}/v1/listen?${qs.toString()}`, {
        method: 'POST',
        headers: { authorization: `Token ${provider.apiKey}`, 'content-type': input.contentType || 'audio/wav' },
        body: input.bytes as unknown as BodyInit,
        signal,
      }),
    300_000,
  )
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`deepgram 转写失败 ${res.status}:${t.slice(0, 200)}`)
  }
  const j = (await res.json()) as {
    results?: { utterances?: DgUtterance[]; channels?: { alternatives?: { transcript?: string; words?: DgWord[] }[] }[] }
    metadata?: { duration?: number }
  }
  const utts = j.results?.utterances
  let segments: AudioSegment[] = []
  if (Array.isArray(utts) && utts.length) {
    segments = utts.map((u) => ({
      start: num(u.start),
      end: num(u.end),
      speaker: input.diarize && u.speaker != null ? `S${u.speaker + 1}` : null,
      text: u.transcript || '',
    }))
  } else {
    const alt = j.results?.channels?.[0]?.alternatives?.[0]
    const words = Array.isArray(alt?.words) ? alt.words : []
    segments = words.map((w) => ({
      start: num(w.start),
      end: num(w.end),
      speaker: input.diarize && w.speaker != null ? `S${w.speaker + 1}` : null,
      text: (w.punctuated_word || w.word || '') + ' ',
    }))
  }
  const text =
    j.results?.channels?.[0]?.alternatives?.[0]?.transcript || segments.map((s) => s.text).join('').trim()
  const seconds = num(j.metadata?.duration) || segments.reduce((a, s) => Math.max(a, s.end), 0)
  return { text, language: input.language, segments, seconds }
}

/* ------------------------------ AssemblyAI ------------------------------ */
async function transcribeAssemblyAI(
  provider: GatewayProvider,
  input: AudioInput,
): Promise<NormalizedTranscript> {
  const base = provider.baseUrl
  const uploadRes = await withTimeout(
    (signal) =>
      fetch(`${base}/v2/upload`, {
        method: 'POST',
        headers: { authorization: provider.apiKey },
        body: input.bytes as unknown as BodyInit,
        signal,
      }),
    120_000,
  )
  if (!uploadRes.ok) throw new Error(`assemblyai 上传失败 ${uploadRes.status}`)
  const uploadUrl = ((await uploadRes.json()) as { upload_url?: string }).upload_url
  if (!uploadUrl) throw new Error('assemblyai 未返回 upload_url')

  const createRes = await withTimeout(
    (signal) =>
      fetch(`${base}/v2/transcript`, {
        method: 'POST',
        headers: { authorization: provider.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          audio_url: uploadUrl,
          speaker_labels: input.diarize,
          language_code: input.language || undefined,
        }),
        signal,
      }),
    60_000,
  )
  if (!createRes.ok) throw new Error(`assemblyai 创建任务失败 ${createRes.status}`)
  const id = ((await createRes.json()) as { id?: string }).id
  if (!id) throw new Error('assemblyai 未返回任务 id')

  const deadline = Date.now() + 300_000
  for (;;) {
    if (Date.now() > deadline) throw new Error('assemblyai 转写超时')
    await new Promise((r) => setTimeout(r, 3000))
    const pollRes = await fetch(`${base}/v2/transcript/${id}`, { headers: { authorization: provider.apiKey } })
    if (!pollRes.ok) throw new Error(`assemblyai 轮询失败 ${pollRes.status}`)
    const j = (await pollRes.json()) as {
      status?: string
      error?: string
      text?: string
      language_code?: string
      audio_duration?: number
      utterances?: { start?: number; end?: number; speaker?: string; text?: string }[]
    }
    if (j.status === 'error') throw new Error(`assemblyai 转写错误:${j.error || ''}`)
    if (j.status !== 'completed') continue
    const utts = Array.isArray(j.utterances) ? j.utterances : []
    const segments: AudioSegment[] = utts.map((u) => ({
      start: num(u.start) / 1000,
      end: num(u.end) / 1000,
      speaker: input.diarize && u.speaker ? `S${u.speaker}` : null,
      text: u.text || '',
    }))
    return {
      text: j.text || segments.map((s) => s.text).join(' '),
      language: j.language_code,
      segments,
      seconds: num(j.audio_duration),
    }
  }
}

/* ------------------------------ 分派 ------------------------------ */
export async function transcribeAudio(
  provider: GatewayProvider,
  input: AudioInput,
): Promise<NormalizedTranscript> {
  switch (provider.api) {
    case 'deepgram':
      return transcribeDeepgram(provider, input)
    case 'assemblyai':
      return transcribeAssemblyAI(provider, input)
    default:
      return transcribeOpenAI(provider, input)
  }
}
