'use client'

import type { CreatureDna } from '@zx/shared/creature'
import type { compileBlueprint } from '@zx/shared/creature'
import { RigCreature } from '@/components/lab/renderers/RigCreature'

/**
 * 把 `RigCreature` 的 SVG 渲染成 PNG data URL。
 *
 * 从 `JudgeLab.tsx` 抽出来的共享工具 —— 裁判台与「创建生物」都要用它出图。
 *
 * 流程:离屏挂一个容器 → 用 ReactDOM 渲染 → 取 `<svg>` → `XMLSerializer` 序列化 →
 * `Image` 载入 → 画到 canvas(先铺中性底色)→ `toDataURL`。
 *
 * 为什么必须**先铺底色**:RigCreature 的 SVG 没有背景矩形,直接转 PNG 是透明底。
 * 透明底喂给 VLM,不同模型处理不一(有的当黑底、有的当白底),而且 32×32 的
 * 纯色图会被误判成「空白」。统一浅灰底,保证「看到的就是人看到的」。
 */

/** 出图尺寸。VLM 侧 detail='low' 时约 512 内,256~320 足够看清形体又不浪费 token */
export const RENDER_BOX = 300

/** 中性背景:透明 PNG 各模型处理不一,统一铺一层浅灰底,免得被判成「白色空白」 */
export const RENDER_BG = '#f2f0f5'

export async function renderToPng(
  dna: CreatureDna,
  rig: ReturnType<typeof compileBlueprint>['rig'],
  matureDay: number,
  box = RENDER_BOX,
): Promise<string> {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await new Promise<void>((res) => {
      root.render(<RigCreature dna={dna} rig={rig} box={box} fixedDay={matureDay} matureDay={matureDay} />)
      // 等一拍,让 useEffect 里的 draw(formOfDay...) 把 transform 写进 DOM
      requestAnimationFrame(() => requestAnimationFrame(() => res()))
    })
    const svg = host.querySelector('svg')
    if (!svg) throw new Error('未找到 SVG')

    // 补一个背景矩形(见函数注释)
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('x', '0')
    bg.setAttribute('y', '0')
    bg.setAttribute('width', String(box))
    bg.setAttribute('height', String(box))
    bg.setAttribute('fill', RENDER_BG)
    svg.insertBefore(bg, svg.firstChild)

    const str = new XMLSerializer().serializeToString(svg)
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str)
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = box
    canvas.height = box
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无 canvas 2d 上下文')
    ctx.fillStyle = RENDER_BG
    ctx.fillRect(0, 0, box, box)
    ctx.drawImage(img, 0, 0, box, box)
    return canvas.toDataURL('image/png')
  } finally {
    root.unmount()
    host.remove()
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('图片加载失败'))
    img.src = src
  })
}
