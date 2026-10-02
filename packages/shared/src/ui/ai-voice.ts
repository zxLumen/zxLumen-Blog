'use client'

/**
 * AI 状态灯的语音提示:在 `success` / `error` / `blocked` 三次**跳变**时念一句中文。
 *
 * 设计要点(每条都对应一个真会踩的坑):
 *
 * 1. **边沿触发,不是电平触发。** `ai-status.ts` 里有个 1 秒的 TTL ticker,忙着的
 *    时候每秒都会重新渲染;若按「当前是不是 success」来播,就会每秒念一遍。所以只
 *    在聚合态**跳进**目标状态的那一刻播一次。
 * 2. **最小间隔。** 三个源(AI 分身 / Opentodo / 易经)竞争时聚合态会绿→黄→绿地抖,
 *    最小间隔把一串抖动压成偶尔一声。
 * 3. **默认静音。** 这是全站常驻组件,陌生访客打开主页不该被别人的博客突然出声吓到,
 *    由访客自己在状态灯的明细弹层里打开,偏好按访客身份存 localStorage。
 * 4. **后台不播。** 页面不可见时白白消耗访客的注意力还听不见;但**照样消费掉这次
 *    跳变**,免得切回前台时补播一串积压。
 * 5. **被浏览器拒绝就静默跳过。** 自动播放策略要求先有用户手势;拒绝是常态,
 *    不重试、不报错、不刷屏。
 *
 * 音频是预录的 mp3(见 `apps/next-home/public/sounds/ai/README.md` 的来源与生成方式),
 * 不是浏览器 TTS:音色统一、不依赖访客系统里有没有中文语音包。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiState } from './ai-status.js'
import { aiVoiceKey } from './identity.js'

/** 会出声的三个事件;其余状态一律不播 */
export type AiVoiceEvent = 'success' | 'error' | 'blocked'

export const AI_VOICE_EVENTS: readonly AiVoiceEvent[] = ['success', 'error', 'blocked']

/** 状态 → 事件。故意只有三项:`thinking`/`busy` 之类中间态太吵,`idle` 是常态回落 */
export const AI_VOICE_FOR_STATE: Partial<Record<AiState, AiVoiceEvent>> = {
  success: 'success',
  error: 'error',
  blocked: 'blocked',
}

/** 每个事件的候选音频;同事件内随机取一条,避免每次一模一样 */
export const AI_VOICE_FILES: Record<AiVoiceEvent, readonly string[]> = {
  success: ['/sounds/ai/success-1.mp3', '/sounds/ai/success-2.mp3', '/sounds/ai/success-3.mp3'],
  error: ['/sounds/ai/error-1.mp3', '/sounds/ai/error-2.mp3', '/sounds/ai/error-3.mp3'],
  blocked: ['/sounds/ai/blocked-1.mp3', '/sounds/ai/blocked-2.mp3', '/sounds/ai/blocked-3.mp3'],
}

/** 两次播报之间的最小间隔(ms) —— 压制多源抖动 */
export const AI_VOICE_MIN_GAP_MS = 4000

/** 音量:提醒性但不刺耳 */
export const AI_VOICE_VOLUME = 0.55

/**
 * 这次跳变要不要出声。**纯函数**,不碰 DOM —— `tests/ai-voice.test.ts` 直接测它。
 *
 * 注意「不播」与「消费跳变」是两件事:本函数只回答前者,由调用方无条件把
 * `prev` 推进到 `next`(见下方 useAiVoice 的注释)。
 */
export function planVoice(a: {
  /** 上一次的聚合态;null = 本次挂载后的首帧,还没有「跳变」可言 */
  prev: AiState | null
  next: AiState
  enabled: boolean
  /** 页面是否可见 */
  visible: boolean
  /** 上一次真正出声的时刻(ms);0 = 还没出过声 */
  lastPlayedAt: number
  now: number
  gapMs?: number
}): AiVoiceEvent | null {
  if (!a.enabled) return null
  if (a.prev === null) return null // 首帧不播:刷新页面不该先听到一声
  if (a.next === a.prev) return null // 没变
  if (!a.visible) return null // 后台:听不见,还白吵
  const event = AI_VOICE_FOR_STATE[a.next]
  if (!event) return null // 中间态 / idle 不播
  const gap = a.gapMs ?? AI_VOICE_MIN_GAP_MS
  if (a.now - a.lastPlayedAt < gap) return null
  return event
}

/** 同一事件里随机取一条,且不与上一条重复(只有一条候选时照用) */
export function pickVoiceFile(event: AiVoiceEvent, prevFile?: string | null): string {
  const list = AI_VOICE_FILES[event]
  const pool = list.length > 1 ? list.filter((f) => f !== prevFile) : list
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 偏好:按访客身份分键,与昵称/主题/应用栏顺序同规则(mock 身份各算一台设备) */
export function readAiVoicePref(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'on'
  } catch {
    return false // 隐私模式 / 禁用 storage:当作静音,不抛
  }
}

export function writeAiVoicePref(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    /* 存不了就本次会话内有效,不打扰用户 */
  }
}

/**
 * 挂在状态灯上:盯着聚合态,按上面的规则出声。
 *
 * `prev` 在每次判定后**无条件**推进 —— 包括「因为静音/后台而没播」的那些跳变。
 * 否则访客关掉声音逛一圈再打开,或从后台切回前台,会一次性补播积压的所有跳变。
 *
 * 解锁:开启的那一刻就是一次用户手势(点了开关),借它把 <audio> 播一下(音量 0)
 * 让浏览器解除自动播放限制,之后无手势触发的播报也能出声。
 */
export function useAiVoice(
  state: AiState,
  mockId?: string | null,
): { enabled: boolean; toggle: () => void } {
  const key = aiVoiceKey(mockId)
  const [enabled, setEnabled] = useState(false) // 默认静音;useEffect 里再读偏好
  const prev = useRef<AiState | null>(null)
  const lastPlayedAt = useRef(0)
  const lastFile = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    setEnabled(readAiVoicePref(key))
  }, [key])

  const audio = useCallback((): HTMLAudioElement | null => {
    if (typeof Audio === 'undefined') return null
    if (!audioRef.current) audioRef.current = new Audio()
    return audioRef.current
  }, [])

  const play = useCallback(
    (event: AiVoiceEvent, gain: number) => {
      const el = audio()
      if (!el) return
      const file = pickVoiceFile(event, gain > 0 ? lastFile.current : null)
      el.src = file
      el.volume = gain
      // 被自动播放策略拒绝是常态(没手势):静默吞掉,不重试不报错
      el.play().catch(() => {})
      if (gain > 0) {
        lastFile.current = file
        lastPlayedAt.current = Date.now()
      }
    },
    [audio],
  )

  const toggle = useCallback(() => {
    // 副作用一律放在这里,不要塞进 setEnabled 的 updater:updater 必须是纯函数,
    // React(StrictMode 下)会调用它两次,塞副作用就会播两遍
    const next = !enabled
    writeAiVoicePref(key, next)
    setEnabled(next)
    if (next) {
      // 这次点击是用户手势,借它解除自动播放限制,并让访客立刻听到效果
      play('success', 0)
    } else if (audioRef.current) {
      audioRef.current.pause()
    }
  }, [enabled, key, play])

  useEffect(() => {
    const event = planVoice({
      prev: prev.current,
      next: state,
      enabled,
      visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
      lastPlayedAt: lastPlayedAt.current,
      now: Date.now(),
    })
    prev.current = state // 无论出不出声,这次跳变都被消费掉
    if (event) play(event, AI_VOICE_VOLUME)
  }, [state, enabled, play])

  return { enabled, toggle }
}