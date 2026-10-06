/** 后台各面板共用的类型定义 */

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
  /** 是否已授权(存有登录凭证) */
  configured?: boolean
  /** 自动同步是否在跑(已授权且凭证未失效) */
  autoSync?: boolean
  /** 授权时间(ISO) */
  authAt?: string | null
  /** 凭证失效原因(需重新授权) */
  authError?: string | null
  /** 同步密钥(书签 POST 用) */
  syncKey?: string
  /** 快照状态 */
  lastData?: { at?: number; count?: number; start?: string; end?: string } | null
  /** 最近一次同步/校验失败原因 */
  lastError?: string | null
}
