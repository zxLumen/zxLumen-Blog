'use client'

import { useEffect, useRef, useState } from 'react'

interface TypewriterProps {
  text: string
  speed?: number
  startDelay?: number
  className?: string
}

/** 终端打字机效果;尊重 prefers-reduced-motion */
export function Typewriter({ text, speed = 45, startDelay = 250, className }: TypewriterProps) {
  const [shown, setShown] = useState('')
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced.current) {
      setShown(text)
      return
    }

    let i = 0
    let timer: ReturnType<typeof setTimeout>
    setShown('')

    const tick = () => {
      i += 1
      setShown(text.slice(0, i))
      if (i < text.length) {
        timer = setTimeout(tick, speed)
      }
    }

    const start = setTimeout(tick, startDelay)
    return () => {
      clearTimeout(start)
      clearTimeout(timer)
    }
  }, [text, speed, startDelay])

  return (
    <span className={className}>
      <span className="zx-type">{shown}</span>
      <span className="zx-caret" aria-hidden="true" />
    </span>
  )
}
