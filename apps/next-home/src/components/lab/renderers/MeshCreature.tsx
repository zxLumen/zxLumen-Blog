'use client'

/**
 * 渲染器 6 —— WebGL 顶点着色器位移网格。
 *
 * 一张 (NU × NV) 的网格,顶点位置**完全在 vertex shader 里算出来**:
 * 顶点只知道自己的 `(u, v)`(由 `gl_VertexID` 反推,不传任何顶点属性),去一张
 * 贴图里 `texelFetch` 采样中轴在该处的 `(x, y, 半宽, 切线角)`,再沿法线/切线
 * 铺开成一个闭合的管状体。CPU 每帧只上传那张几十像素宽的中轴纹理。
 *
 * 所以「一只会动的生物」在 GPU 上是**零几何更新成本**的:网格拓扑永不改变,
 * 变的只是一张小纹理。
 *
 * 与前五条路线的性格差异:**表面连续、有体积、有高光**,是唯一"有实感"的;
 * 但轮廓是解析式的,不如 SVG 自由,也拿不到软体那种随机个性。
 */

import { useCallback, useRef, useState } from 'react'
import type { CreatureDna, FormState } from '@zx/shared/creature'
import { buildSpine, useCreatureLoop, channel, agitationOf, formOfDay } from './shared'
import { buildProgram, uniforms, makeDataTexture, uploadTexture, useGlLoop } from './webgl'

/** 中轴纹理宽度:够密才能让插值平滑,48 已经绰绰有余(纹理只有 192 字节) */
const SPINE_N = 48
/** 网格密度:沿中轴 64 段 × 绕截面 12 点 */
const NU = 64
const NV = 12

const VS = `#version 300 es
precision highp float;

uniform sampler2D uSpine;      // (x, y, halfWidth, tangentAngle)
uniform float uSpineN;
uniform float uTime;
uniform float uFlapHz;
uniform float uFlapAmp;
uniform float uGlow;
uniform float uSegments;
uniform float uSpin;
uniform float uScale;
uniform vec2  uCenter;
uniform float uBox;
uniform float uEthereal;
uniform float uAgit;

out vec3 vN;
out float vRing;
out float vU;

void main() {
  // 由顶点序号反推网格坐标 —— 不需要任何顶点属性缓冲
  int id = gl_VertexID;
  int iv = id % ${NV};
  int iu = id / ${NV};
  float u = float(iu) / float(${NU} - 1);
  float v = float(iv) / float(${NV});   // 绕截面的圈数
  float a = v * 6.2831853;

  // 采样中轴。texelFetch 只接受整数量化,所以这里用 iu/N 做索引 + 相邻点手动插值,
  // 而不是靠硬件的双线性过滤(RGBA32F 不可线性过滤)。
  float fp = u * (uSpineN - 1.0);
  int i0 = int(floor(fp));
  int i1 = min(i0 + 1, int(uSpineN) - 1);
  float f = fp - floor(fp);
  vec4 s0 = texelFetch(uSpine, ivec2(i0, 0), 0);
  vec4 s1 = texelFetch(uSpine, ivec2(i1, 0), 0);
  vec4 s = mix(s0, s1, f);

  vec2 P  = s.xy;
  float W = max(0.35, s.z);
  float ang = s.w;
  vec2 T = vec2(cos(ang), sin(ang));   // 切线
  vec2 Nn = vec2(-sin(ang), cos(ang)); // 法线

  // 截面:法线方向 ±,切线方向做椭圆压扁(截面不是正圆,更像有机体)
  float cr = cos(a);
  float sr = sin(a);
  vec2 radial = Nn * cr * W + T * sr * W * 0.62;

  // 体节:segments 越多、环越明显 —— 躯干「一节一节」长出来
  float ring = sin(u * uSegments * 6.2831853 - uTime * uFlapHz * 1.4);
  radial *= 1.0 + ring * (0.06 + uGlow * 0.05);

  // 扇动:绕切线摆动,越靠尾摆得越少(翼根到翼尖)
  float flap = sin(uTime * uFlapHz * 6.2831853 - u * 5.0) * uFlapAmp * (1.0 - u * 0.72);
  // 摆动方向 = 截面法线在法线平面内的投影 → 看起来像"这一片在扇"
  vec2 flapDir = normalize(Nn + T * 0.0001);
  radial += flapDir * (abs(sr)) * flap;

  // 有机抖动:两三个不同频率的正弦叠加,零噪声库
  float w1 = sin(P.x * 0.13 + uTime * 1.7);
  float w2 = cos(P.y * 0.11 - uTime * 1.3);
  float wob = (0.5 + 0.5 * uAgit) * (0.12 + uGlow * 0.1);
  radial += Nn * (w1 + w2) * wob * W * 0.35;

  vec2 pos = P + radial;

  // 整体自旋
  float sp = sin(uTime * 0.45) * uSpin * 0.24;
  float cs = cos(sp), sn = sin(sp);
  pos = vec2(pos.x * cs - pos.y * sn, pos.x * sn + pos.y * cs);

  vec2 screen = uCenter + pos * uScale;
  vec2 clip = screen * (2.0 / uBox) - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  // 传给片元的:径向方向当法线用(足够做高光与边缘光)
  vec2 worldN = normalize(Nn * cr + T * sr * 0.62 + vec2(0.0001));
  vN = vec3(worldN * cs - vec2(0.0, 1.0) * sn, 0.0);
  vRing = ring;
  vU = u;
}`

const FS = `#version 300 es
precision highp float;

in vec3 vN;
in float vRing;
in float vU;

uniform vec3 uBody;
uniform vec3 uAccent;
uniform vec3 uGlowCol;
uniform float uGlow;
uniform float uEthereal;
uniform float uAgit;

out vec4 o;

void main() {
  // 光从左上偏前来,固定方向就够,不需要真的法线矩阵
  vec3 L = normalize(vec3(-0.45, 0.72, 0.55));
  vec3 N = normalize(vN + vec3(0.0, 0.0, 0.9));  // 偏向观察者,避免侧缘全黑
  float diff = clamp(dot(N, L), 0.0, 1.0);

  // 边缘光:管状体边缘最亮 —— 这是让体积感成立的关键
  float rim = pow(1.0 - clamp(N.z, 0.0, 1.0), 2.2);

  // 体节的暗带:让"一节一节"看得见
  float band = smoothstep(0.35, -0.9, vRing) * (0.18 + uGlow * 0.1);

  vec3 col = uBody * (0.34 + diff * 0.72);
  col = mix(col, uAccent, band + vU * 0.18);
  col += uGlowCol * rim * (0.25 + uGlow * 0.95);
  col += uGlowCol * (0.05 + uAgit * 0.06) * (1.0 - vU);

  // 空灵:越空灵越透(头尾收一点),实体生物保持不透明
  float a = 1.0 - uEthereal * 0.42 * (0.45 + 0.55 * abs(sin(vU * 3.14159)));
  o = vec4(col, clamp(a, 0.06, 1.0));
}`

export interface MeshCreatureProps {
  dna: CreatureDna
  box?: number
}

export function MeshCreature({ dna, box = 190 }: MeshCreatureProps) {
  /*
   * 中轴纹理的上传缓冲:每帧被写的可变 TypedArray,不是渲染要读的状态,
   * 也不能在渲染期被改。`useState` 的惰性初始化保证身份恒定。
   */
  const [spineData] = useState(() => new Float32Array(SPINE_N * 4))
  const formRef = useRef<FormState>(formOfDay(dna, 0))

  const build = useCallback(
    (gl: WebGL2RenderingContext) => {
      const prog = buildProgram(gl, VS, FS)
      const U = uniforms(gl, prog, [
        'uSpine', 'uSpineN', 'uTime', 'uFlapHz', 'uFlapAmp', 'uGlow', 'uSegments',
        'uSpin', 'uScale', 'uCenter', 'uBox', 'uEthereal', 'uAgit',
        'uBody', 'uAccent', 'uGlowCol',
      ])
      const tex = makeDataTexture(gl, SPINE_N, 1)
      // 没有任何顶点属性,但仍要绑一个空 VAO —— 保持状态可预测
      const vao = gl.createVertexArray()

      gl.enable(gl.BLEND)
      // 预乘输出 + (ONE, ONE_MINUS_SRC_ALPHA):空灵形态靠 alpha 混合才有通透感
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.disable(gl.DEPTH_TEST)

      return {
        frame(now: number, dpr: number) {
          const form = formRef.current

          // --- CPU 侧只做这一件事:把中轴写进纹理 ---
          const spine = buildSpine(form)
          for (let i = 0; i < SPINE_N; i++) {
            const p = spine[Math.min(spine.length - 1, Math.round((i / (SPINE_N - 1)) * (spine.length - 1)))]
            const o = i * 4
            spineData[o] = p.x
            spineData[o + 1] = p.y
            spineData[o + 2] = p.w
            spineData[o + 3] = p.ang
          }
          uploadTexture(gl, tex, SPINE_N, 1, spineData)

          const agit = agitationOf(form.traits)
          // 与 Canvas 版同一套「体型占画布相近比例」的约定
          const scale = (box * 0.3) / Math.max(1, form.size)
          const bob = Math.sin(now * 1.6 + 0.4) * form.bobPx * scale * 2.4

          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          gl.useProgram(prog)
          gl.bindVertexArray(vao)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, tex)

          gl.uniform1i(U.uSpine, 0)
          gl.uniform1f(U.uSpineN, SPINE_N)
          gl.uniform1f(U.uTime, now)
          gl.uniform1f(U.uFlapHz, form.flapHz)
          gl.uniform1f(U.uFlapAmp, (0.12 + form.glow * 0.18) * (0.5 + agit))
          gl.uniform1f(U.uGlow, form.glow)
          gl.uniform1f(U.uSegments, form.segments)
          gl.uniform1f(U.uSpin, form.spin)
          gl.uniform1f(U.uScale, scale)
          gl.uniform2f(
            U.uCenter,
            box / 2 + Math.sin(now * 0.31) * form.driftAmp * scale * 1.6,
            box / 2 + bob,
          )
          gl.uniform1f(U.uBox, box)
          gl.uniform1f(U.uEthereal, form.traits.ethereal / 5)
          gl.uniform1f(U.uAgit, agit)
          gl.uniform3f(
            U.uBody,
            channel(form.palette.body, 'r'),
            channel(form.palette.body, 'g'),
            channel(form.palette.body, 'b'),
          )
          gl.uniform3f(
            U.uAccent,
            channel(form.palette.accent, 'r'),
            channel(form.palette.accent, 'g'),
            channel(form.palette.accent, 'b'),
          )
          gl.uniform3f(
            U.uGlowCol,
            channel(form.palette.glow, 'r'),
            channel(form.palette.glow, 'g'),
            channel(form.palette.glow, 'b'),
          )

          // NU × NV 的网格顺序排列 → 一条 TRIANGLE_STRIP 就能铺满,不需要索引
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, NU * NV)
          gl.bindVertexArray(null)
          void dpr
        },

        dispose() {
          gl.deleteVertexArray(vao)
          gl.deleteTexture(tex)
          gl.deleteProgram(prog)
        },
      }
    },
    [box, spineData],
  )

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