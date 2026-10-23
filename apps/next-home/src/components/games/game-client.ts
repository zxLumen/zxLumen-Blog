'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { GameAction, GameId, RoomViewBase } from '@/lib/games/types'

export type AnyRoomView = RoomViewBase<unknown>

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `请求失败（${res.status}）`
    const err = new Error(message) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data as T
}

export function createRoom(game: GameId, name: string): Promise<{ room: AnyRoomView }> {
  return request('/api/games/rooms', {
    method: 'POST',
    body: JSON.stringify({ game, name }),
  })
}

export function joinRoom(code: string, name: string): Promise<{ room: AnyRoomView }> {
  return request(`/api/games/rooms/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function fetchRoom(code: string): Promise<AnyRoomView> {
  return request(`/api/games/rooms/${encodeURIComponent(code)}`)
}

export function fetchSession(): Promise<{ room: AnyRoomView | null }> {
  return request('/api/games/session')
}

export function sendAction(code: string, action: GameAction): Promise<AnyRoomView> {
  return request(`/api/games/rooms/${encodeURIComponent(code)}/action`, {
    method: 'POST',
    body: JSON.stringify(action),
  })
}

export function leaveRoom(code: string): Promise<{ ok: true }> {
  return request(`/api/games/rooms/${encodeURIComponent(code)}/leave`, {
    method: 'DELETE',
  })
}

function readRoomFromUrl(): string {
  if (typeof window === 'undefined') return ''
  return (new URLSearchParams(window.location.search).get('room') ?? '').trim().toUpperCase()
}

export interface GameRoomState {
  room: AnyRoomView | null
  checking: boolean
  busy: boolean
  error: string
  /** URL 里带来的房间号（邀请链接）；没有会话时用于预填加入表单 */
  inviteCode: string
  create: (name: string) => Promise<boolean>
  join: (code: string, name: string) => Promise<boolean>
  act: (action: GameAction) => Promise<boolean>
  leave: () => Promise<void>
  refresh: () => Promise<void>
  clearError: () => void
}

/**
 * 所有酒桌游戏共用的房间连接器：
 * - 建立/加入时服务端写 HttpOnly cookie，关页面再打开由 /api/games/session 恢复
 * - 房间页每秒轮询一次（页面隐藏时降频），动作后立即拿新视图
 * - 不把玩家 token 放进 localStorage / JS，防 XSS 偷令牌
 */
export function useGameRoom(game: GameId): GameRoomState {
  const router = useRouter()
  const [room, setRoomState] = useState<AnyRoomView | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [inviteCode, setInviteCode] = useState(readRoomFromUrl)
  const roomRef = useRef<AnyRoomView | null>(null)
  const stoppedRef = useRef(false)

  const setRoom = useCallback((next: AnyRoomView | null) => {
    roomRef.current = next
    setRoomState(next)
  }, [])

  const replaceUrl = useCallback((code: string | null) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (code) url.searchParams.set('room', code)
    else url.searchParams.delete('room')
    window.history.replaceState(null, '', url.toString())
  }, [])

  // 首次进入：先认 cookie 里的房间；邀请链接带 ?room= 时优先给加入表单
  useEffect(() => {
    let cancelled = false
    const invite = readRoomFromUrl()

    ;(async () => {
      try {
        const session = await fetchSession()
        if (cancelled) return
        const sessionRoom = session.room
        if (sessionRoom) {
          if (sessionRoom.game !== game) {
            // 上一局是另一个游戏：没有邀请链接时直接送回去，保证「关掉页面再打开能回来」
            if (!invite) {
              router.replace(`/games/${sessionRoom.game}?room=${sessionRoom.code}`)
              return
            }
          } else if (!invite || invite === sessionRoom.code) {
            setRoom(sessionRoom)
            replaceUrl(sessionRoom.code)
            return
          }
        }
      } catch {
        /* cookie 失效 / 网络抖动：当没有会话 */
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [game, replaceUrl, router, setRoom])

  // 房间轮询：动作后立即拿一次，平时 1.2s；页面隐藏时 5s
  useEffect(() => {
    const code = room?.code
    if (!code) return
    stoppedRef.current = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      if (stoppedRef.current) return
      try {
        const next = await fetchRoom(code)
        if (stoppedRef.current) return
        setRoomState((prev) => {
          if (prev && prev.code === next.code && prev.version > next.version) return prev
          roomRef.current = next
          return next
        })
      } catch (e) {
        const status = (e as Error & { status?: number }).status
        if (status === 401 || status === 404) {
          setRoom(null)
          setError(status === 404 ? '房间已结束' : '你已不在这个房间（可能被房主移出）')
          return
        }
      }
      timer = setTimeout(tick, document.visibilityState === 'hidden' ? 5000 : 1200)
    }

    timer = setTimeout(tick, 600)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stoppedRef.current) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(tick, 80)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stoppedRef.current = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [room?.code, setRoom])

  const create = useCallback(
    async (name: string) => {
      setBusy(true)
      setError('')
      try {
        const { room: next } = await createRoom(game, name)
        setRoom(next)
        setInviteCode('')
        replaceUrl(next.code)
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [game, replaceUrl, setRoom],
  )

  const join = useCallback(
    async (code: string, name: string) => {
      setBusy(true)
      setError('')
      try {
        const { room: next } = await joinRoom(code, name)
        setRoom(next)
        setInviteCode('')
        replaceUrl(next.code)
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [replaceUrl, setRoom],
  )

  const act = useCallback(
    async (action: GameAction) => {
      const code = roomRef.current?.code
      if (!code) return false
      setBusy(true)
      setError('')
      try {
        const next = await sendAction(code, action)
        setRoom(next)
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [setRoom],
  )

  const leave = useCallback(async () => {
    const code = roomRef.current?.code
    if (code) {
      try {
        await leaveRoom(code)
      } catch {
        /* 已经不在房间也当离开成功 */
      }
    }
    setRoom(null)
    setInviteCode('')
    replaceUrl(null)
  }, [replaceUrl, setRoom])

  const refresh = useCallback(async () => {
    const code = roomRef.current?.code
    if (!code) return
    try {
      const next = await fetchRoom(code)
      setRoom(next)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [setRoom])

  return {
    room,
    checking,
    busy,
    error,
    inviteCode,
    create,
    join,
    act,
    leave,
    refresh,
    clearError: () => setError(''),
  }
}
