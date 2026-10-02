'use client'

/**
 * WebGL 公共底座:着色器编译、program 链接、VAO、以及把 GPU 资源和 rAF 接起来。
 *
 * 这里刻意**不引第三方库**:整套渲染只有「N 个点 + 每点几个属性」,直接手写
 * VAO + GLSL 反而最短、最好调,也没有版本升级地雷。
 *
 * WebGL2 在全平台已可用,所以两个 WebGL 渲染器都直接要 webgl2,不写 webgl1 回退 ——
 * lab 的目的是比效果,不是兼容老浏览器。
 */

import { useEffect, useRef } from 'react'
import { dayStore } from '../store'
import { usePrefersReducedMotion } from './shared'

const TRIVIAL_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('createShader 失败')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '未知错误'
    gl.deleteShader(s)
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'
    throw new Error(`${kind} 着色器编译失败:\n${log}`)
  }
  return s
}

/**
 * 编译 + 链接;失败时把 infoLog 抛出来(lab 要能看见为什么黑屏,而不是黑屏)。
 *
 * `tfVaryings` 用于 transform feedback:**必须在 linkProgram 之前**声明 ——
 * 链接后输出变量名已固化进程序,再改来不及。
 */
export function buildProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string = TRIVIAL_FS,
  tfVaryings?: string[],
): WebGLProgram {
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  const p = gl.createProgram()
  if (!p) throw new Error('createProgram 失败')
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  if (tfVaryings?.length) gl.transformFeedbackVaryings(p, tfVaryings, gl.INTERLEAVED_ATTRIBS)
  gl.linkProgram(p)
  // 链接后即可释放 shader,program 自己持有引用
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '未知错误'
    gl.deleteProgram(p)
    throw new Error(`program 链接失败:\n${log}`)
  }
  return p
}

/** 取一组 uniform location;`null` 是合法的(WebGL 允许未使用的 uniform 被优化掉) */
export function uniforms(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  names: string[],
): Record<string, WebGLUniformLocation | null> {
  const out: Record<string, WebGLUniformLocation | null> = {}
  for (const n of names) out[n] = gl.getUniformLocation(prog, n)
  return out
}

/* ---------------------------- 缓冲区 ---------------------------- */

export interface Vao {
  vao: WebGLVertexArrayObject
  buf: WebGLBuffer
}

/**
 * 建一个属性缓冲 + VAO。
 *
 * `attrs` 按顺序声明,每个 `{ loc, size }`;`data` 是 Float32Array,按属性顺序摊平。
 * loc 与 `layout(location=)` 一一对应,写死 0..n 比查 `getAttribLocation` 省事且更快。
 */
export function makeVao(
  gl: WebGL2RenderingContext,
  attrs: { loc: number; size: number }[],
  data: Float32Array,
  usage?: number,
): Vao {
  const vao = gl.createVertexArray()
  if (!vao) throw new Error('createVertexArray 失败')
  const buf = gl.createBuffer()
  if (!buf) throw new Error('createBuffer 失败')

  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, data, usage ?? gl.STATIC_DRAW)

  const stride = attrs.reduce((n, a) => n + a.size, 0) * 4
  let offset = 0
  for (const a of attrs) {
    gl.enableVertexAttribArray(a.loc)
    gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride, offset)
    offset += a.size * 4
  }
  gl.bindVertexArray(null)
  return { vao, buf }
}

export function updateBuffer(gl: WebGL2RenderingContext, buf: WebGLBuffer, data: Float32Array) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
}

/** 按 DPR 与 CSS 尺寸同步绘图缓冲 */
export function syncSize(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  cssSize: number,
): number {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const px = Math.max(1, Math.round(cssSize * dpr))
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px
    canvas.height = px
    // 同 fitCanvas:不钉 CSS 尺寸,dpr=2 时元素会按后备缓冲区布局而撑成两倍
    canvas.style.width = `${cssSize}px`
    canvas.style.height = `${cssSize}px`
  }
  gl.viewport(0, 0, px, px)
  return dpr
}

/** 1D 数据纹理(`RGBA32F` + `NEAREST` → WebGL2 核心能力,不需要扩展) */
export function makeDataTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('createTexture 失败')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
  return tex
}

export function uploadTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  w: number,
  h: number,
  data: Float32Array,
) {
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data)
}

/* ---------------------------- 资源生命周期 + rAF ---------------------------- */

/** `build` 的返回值:一次性的资源 + 每帧回调 */
export interface GlLoopHandlers {
  /** 每帧绘制。`now` 是相对挂载时刻的秒数 */
  frame: (now: number, dpr: number) => void
  dispose: () => void
}

/**
 * 建一次 GPU 资源,并让它自己跑一条 rAF 循环。
 *
 * 与 `useCreatureLoop` 的分工:那条负责**读天数 → 算出形态**(存进 `formRef`),
 * 这条负责**拿形态画**。形态经 ref 交接,两条循环各自独立推进 ——
 * 不能合成一条:WebGL 的 GL 状态机要求 `useProgram` 之后连续设置 uniform,
 * 夹进别的渲染器的绘制会打断它。
 */
export interface GlLoop {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /**
   * 失败提示元素。**故意不用 React state** ——
   * WebGL 初始化只可能失败一次、且失败后不会自愈,为此多跑一次重渲染不划算;
   * 直接写 DOM(隐藏 canvas + 显示提示)语义等价,也没有 setState-in-effect 问题。
   */
  noticeRef: React.RefObject<HTMLDivElement | null>
}

export function useGlLoop(box: number, build: (gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) => GlLoopHandlers): GlLoop {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const noticeRef = useRef<HTMLDivElement | null>(null)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    const notice = noticeRef.current
    if (!canvas || !notice) return

    const fail = (msg: string) => {
      notice.textContent = msg
      notice.hidden = false
      canvas.style.display = 'none'
    }

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true })
    if (!gl) {
      fail('此浏览器不支持 WebGL2')
      return
    }
    let setup: GlLoopHandlers
    try {
      setup = build(gl, canvas)
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
      return
    }

    let raf = 0
    const t0 = performance.now()
    // reduced motion:只在天数变化时渲染一帧,静态展示当前姿态
    let lastDay = NaN
    const loop = (now: number) => {
      const day = dayStore.get()
      if (!reduced || day !== lastDay) {
        const ts = (now - t0) / 1000
        const dpr = syncSize(gl, canvas, box)
        setup.frame(ts, dpr)
        lastDay = day
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      setup.dispose()
      // 复原:同一 canvas 上重新初始化成功时,别让上一轮的提示继续盖着
      notice.hidden = true
      notice.textContent = ''
      canvas.style.display = ''
    }
  }, [box, build, reduced])

  return { canvasRef, noticeRef }
}