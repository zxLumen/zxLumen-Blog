'use client'

import { useEffect, useRef } from 'react'
import { trackEvent } from './track.js'

/** 页面加载时上报一次访问(模块/实例级去重,避免 React StrictMode 重复计数) */
export function TrackBeacon({ path = '/' }: { path?: string }) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    trackEvent('visit', path)
  }, [path])
  return null
}
