/** 后台各面板共用的类型定义 */

export interface NotifyMsg {
  kind: 'ok' | 'err'
  text: string
}

export type TabKey = 'comments' | 'archive' | 'profile' | 'token' | 'stats' | 'projects' | 'themes'

export const VALID_TABS: readonly TabKey[] = [
  'comments',
  'archive',
  'profile',
  'token',
  'stats',
  'projects',
  'themes',
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
}

export interface ZhipuStatus {
  configured?: boolean
  baseUrl?: string
  lastError?: string | null
  lastData?: { at?: number; count?: number } | null
}
