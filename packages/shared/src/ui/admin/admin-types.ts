/** 后台各面板共用的类型定义 */
import type { MinimaxQuota } from '../usage/constants.js'

export interface NotifyMsg {
  kind: 'ok' | 'err'
  text: string
}

export type TabKey =
  | 'comments'
  | 'archive'
  | 'profile'
  | 'token'
  | 'stats'
  | 'projects'
  | 'vlog'
  | 'apps'
  | 'themes'
  | 'chatbot'
  | 'ai'

export const VALID_TABS: readonly TabKey[] = [
  'comments',
  'archive',
  'profile',
  'token',
  'stats',
  'projects',
  'vlog',
  'apps',
  'themes',
  'chatbot',
  'ai',
]

export const validTab = (t: unknown): t is TabKey => VALID_TABS.includes(t as TabKey)

export interface DsStatus {
  configured?: boolean
  exp?: number | null
  expired?: boolean | null
  lastSync?: string | null
  syncKey?: string
  lastError?: string | null
  lastData?: { at?: number; count?: number } | null
}

export interface OcWsItem {
  id: string
  name: string
  key: string
  hasKey?: boolean
}

export interface OcStatus {
  configured?: boolean
  consoleUrl?: string
  workspaces?: Array<{ id: string; name: string; hasKey?: boolean }>
  lastError?: string | null
  lastData?: { at?: number; count?: number; since?: string } | null
  /** 控制台推理日志(精确小时)凭据状态 */
  console?: {
    configured?: boolean
    org?: string
    at?: string
    error?: string
    sync?: { running?: boolean; startedAt?: number; at?: number; hours?: number; orgs?: number; error?: string }
  }
}

export interface ZhipuStatus {
  configured?: boolean
  baseUrl?: string
  lastError?: string | null
  lastData?: { at?: number; count?: number } | null
}

export interface MmStatus {
  /** 是否已配置(订阅 Key / 会话 Cookie / 已有数据) */
  configured?: boolean
  /** 是否已配置订阅 Key(额度自动同步) */
  subKeySet?: boolean
  /** 是否已配置会话 Cookie(历史自动同步) */
  sessionSet?: boolean
  /** 会话 Cookie 里 _token 的过期时间(ms) */
  sessionExp?: number | null
  /** 最近一次额度快照 */
  quota?: MinimaxQuota | null
  /** 历史快照状态 */
  lastData?: { at?: number; count?: number; start?: string; end?: string } | null
  /** 最近一次同步失败原因 */
  lastError?: string | null
}
