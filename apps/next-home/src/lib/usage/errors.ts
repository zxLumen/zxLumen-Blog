export type UsageErrorCode =
  | 'UNCONFIGURED'
  | 'INVALID_TOKEN'
  | 'INVALID_KEY'
  | 'NO_PERMISSION'
  | 'TIMEOUT'
  | 'HTTP'

/** 构造带 code 的用量错误(供接口区分 unconfigured / invalid / error) */
export function usageError(code: UsageErrorCode, message: string): Error {
  const e = new Error(message)
  ;(e as { code?: string }).code = code
  return e
}

/** 读取错误码(非 Error / 无码返回 undefined) */
export function errorCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code
}

/** 错误码 → 接口 source 字段 */
export function codeToSource(code: string | undefined): 'unconfigured' | 'invalid' | 'error' {
  if (code === 'UNCONFIGURED') return 'unconfigured'
  if (code === 'INVALID_TOKEN' || code === 'INVALID_KEY' || code === 'NO_PERMISSION') return 'invalid'
  return 'error'
}
