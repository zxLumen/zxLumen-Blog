'use client'

import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react'

export interface SiteContentPartial {
  [k: string]: unknown
}

interface SaverCtx {
  /** 保存站点内容片段(带乐观锁;409 自动取最新 rev 重试一次) */
  saveContent: (partial: SiteContentPartial) => Promise<void>
  /** 保存联系方式(邮箱 / 微信 / 电话) */
  saveContacts: (contacts: { email?: string; wechat?: string; phone?: string }) => Promise<void>
}

const Ctx = createContext<SaverCtx | null>(null)

/**
 * 只做「保存」这件事的轻量 Provider —— 没有整体编辑开关,各区块各存各的,
 * 这里仅统一管理 site_content 的乐观锁 rev 与联系方式接口。
 */
export function SiteContentSaverProvider({
  initialRev = '',
  apiBase = '/api',
  children,
}: {
  initialRev?: string
  apiBase?: string
  children: ReactNode
}) {
  const base = apiBase.replace(/\/$/, '')
  const revRef = useRef(initialRev)

  const saveContent = useCallback(
    async (partial: SiteContentPartial) => {
      const post = (rev: string) =>
        fetch(`${base}/admin/site-content`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ partial, rev }),
        })
      let res = await post(revRef.current)
      if (res.status === 409) {
        const j = (await res.json().catch(() => ({}))) as { rev?: string }
        if (j.rev) revRef.current = j.rev
        res = await post(revRef.current)
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || '保存失败')
      }
      const j = (await res.json().catch(() => ({}))) as { rev?: string }
      if (j.rev) revRef.current = j.rev
    },
    [base],
  )

  const saveContacts = useCallback(
    async (contacts: { email?: string; wechat?: string; phone?: string }) => {
      const res = await fetch(`${base}/admin/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contacts }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || '联系方式保存失败')
      }
    },
    [base],
  )

  return <Ctx.Provider value={{ saveContent, saveContacts }}>{children}</Ctx.Provider>
}

export function useSiteContentSaver() {
  return useContext(Ctx)
}
