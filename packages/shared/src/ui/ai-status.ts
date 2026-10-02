'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * 站内「AI 状态总线」。
 *
 * 各 AI 组件(AI 分身 / 应用浮层里的 AI 应用)把当下状态上报到这里,导航栏那盏
 * 状态灯按优先级合并成一盏给访客看。语义(状态枚举 / 优先级 / TTL / 三灯配色与
 * 动画)移植自 AI-Status-Light 的 `aistatus/states.json` 与 `web/control.html` 的
 * 虚拟灯,保证以后把 Mac 上的 agent 灯接进来时无需改设计。
 *
 * 两条边界:
 *  - **纯客户端、按访客自己算、不落库**:访客 A 的灯只反映 A 自己的 AI 活动,
 *    与他人互不影响,刷新即重置。
 *  - **不用 Provider**:模块级 store + `useSyncExternalStore`,任何位置都能直接
 *    用,缺上下文也不会退化(与 AppPanel 的降级思路一致)。
 */

/** 七个状态:与 AI-Status-Light 的 event_states 一致 */
export type AiState = 'idle' | 'thinking' | 'working' | 'busy' | 'success' | 'error' | 'blocked'

export const AI_STATES: readonly AiState[] = [
  'idle',
  'thinking',
  'working',
  'busy',
  'success',
  'error',
  'blocked',
]

/** 优先级,数值大者胜(aistatus/states.json:20-28) */
export const AI_PRIORITY: Record<AiState, number> = {
  blocked: 60,
  error: 50,
  success: 40,
  busy: 30,
  working: 20,
  thinking: 15,
  idle: 0,
}

/**
 * 停留时长(ms):进入该状态后多久自动回落到 idle,0 = 常驻。
 * 成功/出错不立刻熄灭 —— 「刚答完」留一瞬绿光,跟真灯手感一致。
 */
export const AI_TTL: Record<AiState, number> = {
  blocked: 300_000,
  error: 60_000,
  success: 25_000,
  busy: 90_000,
  working: 90_000,
  thinking: 90_000,
  idle: 0,
}

export const AI_LABEL: Record<AiState, string> = {
  idle: '空闲',
  thinking: '思考中',
  working: '工作中',
  busy: '忙碌',
  success: '完成',
  error: '出错',
  blocked: '需要你',
}

/** 交通灯三色:不跟主题走,否则就不像红绿灯了(states.json:38-53) */
export const AI_COLOR: Record<AiState, string> = {
  blocked: '#b06fe8',
  error: '#e8453c',
  busy: '#ff8a00',
  success: '#1faa59',
  thinking: '#f4c20d',
  working: '#f4c20d',
  idle: '#8a8f98',
}

export interface AiSourceDef {
  id: string
  label: string
  /**
   * 仅站长的全局源 —— 预留给将来的 Mac agent 灯(那份状态只属于站长本人)。
   * 访客既看不到它,也不参与合并。
   */
  ownerOnly?: boolean
}

/**
 * 站内 AI 源注册表(决定站长的明细面板里列出谁、顺序如何)。
 * **加一个源 = 在这里登记一行 + 在那个组件里 `useReportAiState(id)` 一行**。
 * 跨子域应用(Opentodo / 易经)不需要本仓库改代码,它们照 docs/AI-STATUS.md 的
 * 协议从 iframe 里 postMessage 上报即可;这里登记 id 只是为了让灯认识这个名字。
 */
export const AI_SOURCES: readonly AiSourceDef[] = [
  { id: 'avatar', label: 'AI 分身' },
  { id: 'opentodo', label: 'Opentodo' },
  { id: 'yijing', label: '易经' },
  { id: 'stock', label: '股票速览' },
]

export interface AiSource {
  id: string
  label: string
  ownerOnly: boolean
  state: AiState
  /** 进入该状态的时刻(ms),TTL 回落据此计算 */
  at: number
  detail?: string
  /**
   * 此刻该源是否可用。跨子域应用(如 Opentodo)只在浮层打开时才有 iframe,
   * 关掉即置 false —— 显示为置灰,且不参与合并。
   */
  available: boolean
}

const entries = new Map<string, AiSource>()
const listeners = new Set<() => void>()
/** getSnapshot 必须返回稳定引用,否则 useSyncExternalStore 会无限重渲染 */
let snapshot: AiSource[] = []
let ticker: ReturnType<typeof setInterval> | null = null

function blank(id: string): AiSource {
  const def = AI_SOURCES.find((s) => s.id === id)
  return {
    id,
    label: def?.label ?? id,
    ownerOnly: def?.ownerOnly ?? false,
    state: 'idle',
    at: 0,
    available: false,
  }
}

function rebuild(): void {
  const list: AiSource[] = []
  for (const def of AI_SOURCES) list.push(entries.get(def.id) ?? blank(def.id))
  // 注册表里没有的(新接的应用先报了状态、后补登记)追加在后面,不丢状态
  for (const s of entries.values()) {
    if (!AI_SOURCES.some((d) => d.id === s.id)) list.push(s)
  }
  snapshot = list
}

function notify(): void {
  rebuild()
  for (const fn of listeners) fn()
}

/** 只在确有「会到期回落」的状态时挂着定时器,空闲时零开销 */
function syncTicker(): void {
  if (ticker !== null) return
  const id = setInterval(() => {
    const now = Date.now()
    let pending = false
    for (const s of entries.values()) {
      if (AI_TTL[s.state] > 0 && now - s.at < AI_TTL[s.state]) {
        pending = true
        break
      }
    }
    if (pending) notify()
    else if (ticker === id) {
      clearInterval(id)
      ticker = null
    }
  }, 1000)
  ticker = id
}

export function subscribeAiStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getAiSources(): AiSource[] {
  return snapshot
}

/** TTL 到期后视为 idle */
export function effectiveAiState(s: AiSource, now: number): AiState {
  const ttl = AI_TTL[s.state]
  if (ttl > 0 && now - s.at >= ttl) return 'idle'
  return s.state
}

/** 合并成一盏:取可见且可用之源里优先级最高者(规则同 aistatus/aggregate.py) */
export function aggregateAiState(sources: AiSource[], admin: boolean, now: number): AiState {
  let best: AiState = 'idle'
  for (const s of sources) {
    if (!s.available) continue
    if (s.ownerOnly && !admin) continue
    const st = effectiveAiState(s, now)
    if (AI_PRIORITY[st] > AI_PRIORITY[best]) best = st
  }
  return best
}

/** 上报某源当下的状态 */
export function reportAiState(id: string, state: AiState, detail?: string): void {
  const prev = entries.get(id) ?? blank(id)
  if (prev.state === state && prev.detail === detail) return
  entries.set(id, { ...prev, state, at: Date.now(), detail })
  syncTicker()
  notify()
}

/**
 * 标记某源此刻是否可用(如浮层开合)。置 false 时同时清成 idle,
 * 免得下次打开还残留上一轮 working —— 那会让灯在没有任何请求时空着。
 */
export function setAiSourceAvailable(id: string, available: boolean): void {
  const prev = entries.get(id) ?? blank(id)
  if (prev.available === available) return
  entries.set(id, { ...prev, available, state: available ? prev.state : 'idle', at: Date.now() })
  syncTicker()
  notify()
}

export function isAiState(v: unknown): v is AiState {
  return typeof v === 'string' && (AI_STATES as readonly string[]).includes(v)
}

/** 组件订阅:返回合并后的灯态与逐源明细(明细已按 TTL 归一) */
export function useAiStatus(admin: boolean): { state: AiState; sources: AiSource[] } {
  const sources = useSyncExternalStore(subscribeAiStatus, getAiSources, getAiSources)
  const now = Date.now()
  const list = sources.map((s) => ({
    ...s,
    state: s.available ? effectiveAiState(s, now) : ('idle' as AiState),
  }))
  return { state: aggregateAiState(list, admin, now), sources: list }
}

/** 组件上报用的稳定回调 */
export function useReportAiState(id: string): (state: AiState, detail?: string) => void {
  return useCallback((state: AiState, detail?: string) => reportAiState(id, state, detail), [id])
}
