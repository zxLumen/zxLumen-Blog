'use client'

/**
 * 渲染器 5 —— WebGL2 GPU 粒子(顶点拉取 + transform feedback)。
 *
 * 粒子状态**永远待在 GPU 上**(一张 Float32Array 的 VBO,ping-pong 两份)。每帧两个 pass:
 *
 *  1. **更新 pass**:`RASTERIZER_DISCARD` + transform feedback。顶点着色器读自己
 *     那份状态、算新状态、写进另一份 VBO。全程无回读 —— `readPixels` 会打断管线,
 *     是手写 GPU 粒子最容易踩的坑。
 *  2. **绘制 pass**:把当前状态 VBO 当普通属性绑上,`drawArrays(POINTS)`。
 *     点精灵 + `gl_PointCoord` 画软圆点,连四边形都不用 6 个顶点。
 *
 * 「顶点拉取」体现在:粒子用 `gl_VertexID` 去锚点纹理 `texelFetch` 自己该回的位置,
 * 状态是被**拉**出来的,而不是外层推给它的。锚点纹理由 CPU 每帧从骨架重算 ——
 * 几十个采样点算起来很便宜,而这恰好是 CPU 更擅长的部分。
 *
 * 混合模式:预乘 alpha + `(ONE, ONE_MINUS_SRC_ALPHA)`。**不用加色混合** ——
 * 实测浅色主题下加色会整片泛白(别改成 ONE/ONE)。
 */

import { useCallback, useRef } from 'react'
import type { CreatureDna, FormState } from '@zx/shared/creature'
import { buildSpine, buildLimbs, useCreatureLoop, channel, agitationOf, formOfDay } from './shared'
import { buildProgram, uniforms, makeVao, makeDataTexture, uploadTexture, useGlLoop } from './webgl'

/** 缓冲区容量:大于任何一帧的绘制数量。多出的粒子照常演化但不绘制 → 数量增长不会「炸开」 */
const MAX_P = 1400
/** 锚点纹理宽度:骨架采样的「家」点数 */
const HOMES = 32
/** 固定步长。GPU 积分不按真实 dt 走 —— 与 Canvas 版一致,六张卡才动得一样 */
const DT = 1 / 60
/** 单帧时长上限(秒),防标签页切回来时积分爆掉 */
const MAX_DT = 1 / 20

/** 每帧被写的锚点上传缓冲。建在 GL 循环内部,不参与渲染。 */
interface AnchorBuffers {
  /** HOMES × 2 行,每点 rgba */
  anchorData: Float32Array
  curAnchors: Float32Array
  /** 上一帧锚点;`null` = 首帧 */
  prevAnchors: Float32Array | null
}

const UPDATE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 p;   // x, y, vx, vy

uniform sampler2D uAnchor;        // 行 0: ax, ay, w, -    行 1: avx, avy, -, -
uniform float uTime;
uniform float uDt;
uniform float uPull;
uniform float uField;
uniform float uTrail;
uniform float uHomeCount;
uniform float uBox;

out vec4 outState;

void main() {
  vec2 pos = p.xy;
  vec2 vel = p.zw;

  int hi = int(mod(float(gl_VertexID), uHomeCount));
  vec4 a0 = texelFetch(uAnchor, ivec2(hi, 0), 0);
  vec4 a1 = texelFetch(uAnchor, ivec2(hi, 1), 0);

  // 回家力 + 追锚点自身速度(不追的话会永远滞后一大截,看起来像在拖后腿)
  vec2 acc = (a0.xy - pos) * uPull;
  acc += (a1.xy - vel) * uPull * 2.4;

  // 旋度流场:与 Canvas 流场版同源的几组 sin/cos,两种路线动起来是同一只生物
  float t = uTime;
  float s1 = sin(pos.x * 0.014 + t * 0.55) * cos(pos.y * 0.012 - t * 0.4);
  float s2 = sin((pos.x + pos.y) * 0.009 + t * 0.31);
  acc += vec2(s1 + s2 * 0.6, s2 - s1 * 0.6) * uField;

  vel += acc * uDt;
  vel *= 1.0 - 1.9 * uDt;
  float sp = length(vel);
  float cap = 1.6 + uTrail * 2.4;
  if (sp > cap) vel *= cap / max(sp, 1e-5);
  pos += vel * uDt * 60.0;

  // 出界直接拉回自家附近。用「拉回」而不是 clamp:clamp 会让粒子在边界堆一条亮线
  if (pos.x < -8.0 || pos.x > uBox + 8.0 || pos.y < -8.0 || pos.y > uBox + 8.0) {
    pos = a0.xy;
    vel = vec2(0.0);
  }

  outState = vec4(pos, vel);
}`

/** `__BOX__` 由 JS 替换成实际画布尺寸 —— 着色器里没有 uniform 也能做常量折叠 */
const DRAW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 p;

uniform sampler2D uAnchor;
uniform float uHomeCount;
uniform float uGlow;
uniform float uTrail;
uniform float uDpr;
uniform vec3 uBody;
uniform vec3 uAccent;

out vec3 vCol;
out float vA;

void main() {
  int hi = int(mod(float(gl_VertexID), uHomeCount));
  vec4 a0 = texelFetch(uAnchor, ivec2(hi, 0), 0);

  vec2 clip = p.xy * (2.0 / __BOX__) - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  // 点大小跟着锚点粗细与辉光走
  gl_PointSize = clamp(a0.z * 0.4 * (0.7 + uGlow * 0.8), 1.8, 26.0) * uDpr;

  // 离锚点越远越偏 accent —— 轮廓因此有颜色层次,而不是一团单色
  float spread = clamp(distance(p.xy, a0.xy) / max(a0.z * 4.0, 1.0), 0.0, 1.0);
  vCol = mix(uBody, uAccent, spread * 0.7);
  vA = (1.0 - spread * 0.55) * (0.14 + uGlow * 0.26) * (0.55 + uTrail * 0.7);
  // 用位置做伪随机闪动,不需要额外随机数上传
  vA *= 0.75 + 0.25 * sin(p.x * 0.13 + p.y * 0.07 + uTrail * 31.0);
}`

const DRAW_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vA;
out vec4 o;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  if (d2 > 1.0) discard;
  float a = vA * (1.0 - d2) * (1.0 - d2);
  if (a < 0.002) discard;
  // 预乘输出,配合 (ONE, ONE_MINUS_SRC_ALPHA)
  o = vec4(vCol * a, a);
}`

export interface GpuParticleCreatureProps {
  dna: CreatureDna
  box?: number
}

export function GpuParticleCreature({ dna, box = 190 }: GpuParticleCreatureProps) {
  /** 当前形态:由公共循环算出,交给 GL 循环渲染(共用同一帧,不额外起 rAF) */
  const formRef = useRef<FormState>(formOfDay(dna, 0))

  /**
   * 把当前骨架写成锚点纹理数据。
   *
   * 这几块 Float32Array 是**每帧被写的上传缓冲**,既不是渲染要读的 state,
   * 也不该在渲染期被改 —— 所以它们建在 `useGlLoop` 的 effect 内部(`build` 里),
   * 生命周期与 GL 循环严格一致。这既过了 React Compiler 的 immutability 检查,
   * 也确实更对:缓冲不该比 GL 资源活得久。
   */
  const packAnchors = useCallback(
    (
      form: FormState,
      bufs: AnchorBuffers,
    ): number => {
      const c = box / 2
      const k = (box * 0.3) / Math.max(1, form.size)
      const spine = buildSpine(form)
      const ls = buildLimbs(form, spine)

      const pts: { x: number; y: number; w: number }[] = []
      for (const p of spine) pts.push({ x: c + p.x * k, y: c + p.y * k, w: p.w * k })
      for (const L of ls) {
        const steps = 3
        for (let i = 1; i <= steps; i++) {
          const t = i / steps
          pts.push({
            x: c + (L.ax + (L.bx - L.ax) * t) * k,
            y: c + (L.ay + (L.by - L.ay) * t) * k,
            w: L.w * 0.5 * k * (1 - t * 0.6),
          })
        }
      }
      if (!pts.length) return 0

      const { anchorData, curAnchors } = bufs
      const prev = bufs.prevAnchors
      for (let i = 0; i < HOMES; i++) {
        const p = pts[i % pts.length]
        const o = i * 4
        anchorData[o] = p.x
        anchorData[o + 1] = p.y
        anchorData[o + 2] = p.w
        anchorData[o + 3] = 0
        // 锚点自身速度(每帧位移):首帧为 0
        anchorData[HOMES * 4 + o] = prev ? curAnchors[i * 2] - p.x : 0
        anchorData[HOMES * 4 + o + 1] = prev ? curAnchors[i * 2 + 1] - p.y : 0
        curAnchors[i * 2] = p.x
        curAnchors[i * 2 + 1] = p.y
      }
      bufs.prevAnchors = prev ? new Float32Array(curAnchors) : null
      return pts.length
    },
    [box],
  )

  const build = useCallback(
    (gl: WebGL2RenderingContext) => {
      // 上传缓冲跟着 GL 资源一起建、一起销毁(每份实例一份,群飞时互不干扰)
      const bufs: AnchorBuffers = {
        anchorData: new Float32Array(HOMES * 2 * 4),
        curAnchors: new Float32Array(HOMES * 2),
        prevAnchors: null,
      }

      const updateProg = buildProgram(gl, UPDATE_VS, undefined, ['outState'])
      // 必须替换成**浮点字面量**(260.0,不是 260)。GLSL ES 没有 float/int 的除法,
      // 写成 `2.0 / 260` 会被驱动判为「wrong operand types」直接编译失败。
      const drawProg = buildProgram(gl, DRAW_VS.replace('__BOX__', box.toFixed(1)), DRAW_FS)

      const U = uniforms(gl, updateProg, [
        'uAnchor', 'uTime', 'uDt', 'uPull', 'uField', 'uTrail', 'uHomeCount', 'uBox',
      ])
      const D = uniforms(gl, drawProg, [
        'uAnchor', 'uHomeCount', 'uGlow', 'uTrail', 'uDpr', 'uBody', 'uAccent',
      ])

      const tex = makeDataTexture(gl, HOMES, 2)

      // --- 种子:沿黄金角铺在中心圆内,比 Math.random 分布均匀得多 ---
      const seed = new Float32Array(MAX_P * 4)
      for (let i = 0; i < MAX_P; i++) {
        const a = i * 2.399963
        const rad = Math.sqrt(i / MAX_P) * box * 0.28
        seed[i * 4] = box / 2 + Math.cos(a) * rad
        seed[i * 4 + 1] = box / 2 + Math.sin(a) * rad
      }
      const A = makeVao(gl, [{ loc: 0, size: 4 }], seed, gl.DYNAMIC_COPY)
      const B = makeVao(gl, [{ loc: 0, size: 4 }], seed, gl.DYNAMIC_COPY)

      const tf = gl.createTransformFeedback()
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.disable(gl.DEPTH_TEST)

      // ping-pong:cur 读、nxt 写,一轮结束交换
      let cur = A
      let nxt = B
      let drawn = 0
      let last = -1

      return {
        frame(now: number, dpr: number) {
          const form = formRef.current
          if (!packAnchors(form, bufs)) return
          uploadTexture(gl, tex, HOMES, 2, bufs.anchorData)
          drawn = Math.round(Math.min(MAX_P, 120 + form.glow * 320 + form.trail * 520 + form.stage * 90))

          // 首帧 last = -1 → dt 取固定步长;之后按真实间隔,但封顶防止切标签页后爆掉
          const dt = last < 0 ? DT : Math.min(MAX_DT, Math.max(0, now - last))
          last = now

          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)

          /* ---- pass 1:更新粒子状态(不产生像素) ---- */
          gl.useProgram(updateProg)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, tex)
          gl.uniform1i(U.uAnchor, 0)
          gl.uniform1f(U.uTime, now)
          gl.uniform1f(U.uDt, dt)
          // 拖尾/流场越强,回家力越松 —— 否则粒子全贴死成一坨实心
          gl.uniform1f(U.uPull, 0.0022 + (1 - form.trail) * 0.0016)
          gl.uniform1f(U.uField, (0.5 + form.trail * 1.6) * (1 + agitationOf(form.traits) * 0.8))
          gl.uniform1f(U.uTrail, form.trail)
          gl.uniform1f(U.uHomeCount, HOMES)
          gl.uniform1f(U.uBox, box)

          gl.bindVertexArray(cur.vao)
          // **必须解绑 ARRAY_BUFFER**。bindVertexArray 只恢复属性指针,不改全局的
          // ARRAY_BUFFER 绑定 —— `makeVao` 建完 B 之后那里一直挂着 B.buf。ping-pong
          // 到「写 B」那一帧,写目标与 ARRAY_BUFFER 指向同一个 buffer,GL 会报
          // GL_INVALID_OPERATION 并给出未定义行为(交替帧触发,很隐蔽)。
          gl.bindBuffer(gl.ARRAY_BUFFER, null)
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf)
          // **必须**在 enable 之前绑定目标缓冲,否则行为未定义(踩过)
          gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, nxt.buf)
          gl.enable(gl.RASTERIZER_DISCARD)
          gl.beginTransformFeedback(gl.POINTS)
          gl.drawArrays(gl.POINTS, 0, MAX_P)
          gl.endTransformFeedback()
          gl.disable(gl.RASTERIZER_DISCARD)
          gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null)

          // 交换:这一帧写进 nxt,下一帧从 nxt 读
          const swap = cur
          cur = nxt
          nxt = swap

          /* ---- pass 2:画 ---- */
          gl.useProgram(drawProg)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, tex)
          gl.uniform1i(D.uAnchor, 0)
          gl.uniform1f(D.uHomeCount, HOMES)
          gl.uniform1f(D.uGlow, form.glow)
          gl.uniform1f(D.uTrail, form.trail)
          gl.uniform1f(D.uDpr, dpr)
          gl.uniform3f(
            D.uBody,
            channel(form.palette.body, 'r'),
            channel(form.palette.body, 'g'),
            channel(form.palette.body, 'b'),
          )
          gl.uniform3f(
            D.uAccent,
            channel(form.palette.accent, 'r'),
            channel(form.palette.accent, 'g'),
            channel(form.palette.accent, 'b'),
          )
          gl.bindVertexArray(cur.vao)
          gl.drawArrays(gl.POINTS, 0, drawn)
          gl.bindVertexArray(null)
        },

        dispose() {
          gl.deleteBuffer(A.buf)
          gl.deleteBuffer(B.buf)
          gl.deleteVertexArray(A.vao)
          gl.deleteVertexArray(B.vao)
          gl.deleteTransformFeedback(tf)
          gl.deleteTexture(tex)
          gl.deleteProgram(updateProg)
          gl.deleteProgram(drawProg)
        },
      }
    },
    [box, packAnchors],
  )

  // 公共循环:读天数 → 算形态 → 存进 formRef(GL 循环下一帧取用)
  useCreatureLoop(dna, (form) => {
    formRef.current = form
  })

  const { canvasRef, noticeRef } = useGlLoop(box, build)

  return (
    <div className="cl-gl-wrap" style={{ width: box, height: box }}>
      <canvas
        ref={canvasRef}
        className="cl-canvas"
        width={box}
        height={box}
        style={{ width: box, height: box }}
        aria-hidden
      />
      {/* 着色器编译失败时才有内容;hook 直接写这个节点,不走 React 状态 */}
      <div ref={noticeRef} className="cl-fallback" hidden />
    </div>
  )
}