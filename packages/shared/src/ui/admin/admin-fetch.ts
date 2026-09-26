/**
 * admin 面板请求统一封装:同源凭证 + 超时。
 *
 * 为什么要超时:跨境链路偶发「连接建立后卡住」时,fetch 会长时间不返回,
 * 面板表现为一直「加载中」且无法恢复;加超时后快速失败,由调用方提示/重试。
 * 调用方可通过 `init.signal` 覆盖默认超时(如控制台日志校验/同步允许更久)。
 */
export const ADMIN_FETCH_TIMEOUT_MS = 15_000

export function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { signal, ...rest } = init
  return fetch(input, {
    credentials: 'same-origin',
    ...rest,
    signal: signal ?? AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
  })
}
