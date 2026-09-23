'use client'

import { createTheme, MantineProvider, type CSSVariablesResolver } from '@mantine/core'
import { useLayoutEffect, useMemo, useState } from 'react'
import { usePrefs } from '../theme-context.js'

/* ------------------------------------------------------------------ */
/* 颜色工具:hex ↔ rgb 混合,用于从 --accent 生成 Mantine 10 档色阶      */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** 把 color 向 target(白或黑)混 pct(0-1),得到中间色 */
function mix(color: string, target: string, pct: number): string {
  const [r1, g1, b1] = hexToRgb(color)
  const [r2, g2, b2] = hexToRgb(target)
  return rgbToHex(r1 + (r2 - r1) * pct, g1 + (g2 - g1) * pct, b1 + (b2 - b1) * pct)
}

/** Mantine 颜色色阶:固定 10 档 */
type ColorScale = [
  string, string, string, string, string,
  string, string, string, string, string,
]

/** 由主题 accent 生成 Mantine 10 档色阶:0 最浅 → 9 最深,index 6 为原色 */
function accentScale(accent: string): ColorScale {
  return [
    mix(accent, '#ffffff', 0.82),
    mix(accent, '#ffffff', 0.66),
    mix(accent, '#ffffff', 0.5),
    mix(accent, '#ffffff', 0.34),
    mix(accent, '#ffffff', 0.18),
    mix(accent, '#ffffff', 0.08),
    accent,
    mix(accent, '#000000', 0.16),
    mix(accent, '#000000', 0.32),
    mix(accent, '#000000', 0.5),
  ]
}

/** 读取当前 data-theme 的计算值(针对 html 元素,即 [data-theme=...]) */
function readThemeTokens() {
  const cs = getComputedStyle(document.documentElement)
  const read = (name: string) => cs.getPropertyValue(name).trim()
  const radiusRaw = read('--radius')
  const radiusNum = parseInt(radiusRaw, 10)
  return {
    accent: read('--accent') || '#0969da',
    radius: Number.isFinite(radiusNum) ? radiusNum : 8,
  }
}

/* ------------------------------------------------------------------ */
/* CSS 变量桥接:语义色全部指向 zx 主题变量,随 18 套主题自动切换        */
/* ------------------------------------------------------------------ */

const zxResolver: CSSVariablesResolver = () => ({
  variables: {
    '--mantine-font-family': 'var(--font-body)',
    '--mantine-font-family-monospace': 'var(--font-mono)',
    '--mantine-radius-default': 'var(--radius)',
  },
  light: {
    '--mantine-color-body': 'var(--bg)',
    '--mantine-color-text': 'var(--fg)',
    '--mantine-color-dimmed': 'var(--fg-dim)',
    '--mantine-color-placeholder': 'var(--fg-muted)',
    '--mantine-color-anchor': 'var(--accent)',
    '--mantine-color-default': 'var(--bg-2)',
    '--mantine-color-default-hover': 'var(--elev)',
    '--mantine-color-default-color': 'var(--fg)',
    '--mantine-color-default-border': 'var(--line)',
    '--mantine-color-error': 'var(--accent-2, #ff6b6b)',
    '--mantine-color-success': 'var(--accent)',
    // 覆盖默认推导的 primary 衍生色(避免依赖固定色板)
    ...derivePrimary('light'),
  },
  dark: {
    '--mantine-color-body': 'var(--bg)',
    '--mantine-color-text': 'var(--fg)',
    '--mantine-color-dimmed': 'var(--fg-dim)',
    '--mantine-color-placeholder': 'var(--fg-muted)',
    '--mantine-color-anchor': 'var(--accent)',
    '--mantine-color-default': 'var(--bg-2)',
    '--mantine-color-default-hover': 'var(--elev)',
    '--mantine-color-default-color': 'var(--fg)',
    '--mantine-color-default-border': 'var(--line)',
    '--mantine-color-error': 'var(--accent-2, #ff6b6b)',
    '--mantine-color-success': 'var(--accent)',
    ...derivePrimary('dark'),
  },
})

function derivePrimary(scheme: 'light' | 'dark') {
  const filled = 'var(--accent)'
  return {
    '--mantine-color-primary-text': filled,
    '--mantine-color-primary-filled': filled,
    '--mantine-color-primary-filled-hover': 'color-mix(in srgb, var(--accent) 88%, var(--bg))',
    '--mantine-color-primary-light': 'color-mix(in srgb, var(--accent) 18%, var(--bg))',
    '--mantine-color-primary-light-hover': 'color-mix(in srgb, var(--accent) 26%, var(--bg))',
    '--mantine-color-primary-light-color': 'var(--accent)',
    '--mantine-color-primary-outline': 'var(--accent)',
    '--mantine-color-primary-outline-hover': 'color-mix(in srgb, var(--accent) 12%, var(--bg))',
    ...(scheme === 'light'
      ? { '--mantine-primary-color-contrast': 'var(--bg)' }
      : { '--mantine-primary-color-contrast': 'var(--bg)' }),
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把子内容包进 MantineProvider,并让 Mantine 的主题色/字形/圆角全部
 * 解析为 zx 主题 CSS 变量。主题 id 切换时,重读 --accent/--radius,
 * 重新生成 primary 色阶(其余全部走 CSS 变量,无需重挂)。
 */
export function MantineBridge({ children }: { children: React.ReactNode }) {
  const { theme, themeMeta } = usePrefs()
  const [tokens, setTokens] = useState<{ accent: string; radius: number } | null>(null)

  useLayoutEffect(() => {
    setTokens(readThemeTokens())
  }, [theme])

  const mantineTheme = useMemo(
    () =>
      createTheme({
        primaryColor: 'primary',
        colors: {
          primary: tokens ? accentScale(tokens.accent) : Array(10).fill('#888') as unknown as ColorScale,
        },
        defaultRadius: tokens?.radius ?? 8,
        cursorType: 'pointer',
      }),
    [tokens],
  )

  // tokens 未就绪时(首帧)先渲染空壳,MantineProvider 只在拿到真实色后挂载,
  // 避免首帧用占位色造成闪烁。
  if (!tokens) return null

  return (
    <MantineProvider
      theme={mantineTheme}
      cssVariablesResolver={zxResolver}
      // 跟随 zx 主题明暗(浅色主题→Mantine 浅色控件;深色主题→深色控件),
      // 而不是跟随系统,避免"晚上系统深色导致 admin 输入框变黑"的错配。
      forceColorScheme={themeMeta.mode}
    >
      {children}
    </MantineProvider>
  )
}