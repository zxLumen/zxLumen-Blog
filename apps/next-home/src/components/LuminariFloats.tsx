"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compileBlueprint, normalizeBlueprint } from "@zx/shared/creature";
import { readFloatsHidden, subscribeFloatsHidden } from "@zx/shared/ui";
import type { CreatureBlueprint } from "@zx/shared/creature";
import { RigCreature } from "@/components/lab/renderers/RigCreature";

/**
 * 四周生灵层(内联渲染,数据经同源代理取自 luminari)。
 *
 * - 每只生灵是独立的 SVG DOM,悬浮在页面上;整层 pointer-events:none,
 *   只有单个生灵放行 hover/点击,不影响主站内容与背景。
 * - 成长按**出生时间**算真实年龄:现实一天 = 长一天,到 matureDay 封顶;
 *   各阶段大小经 fill / minScale 调整,幼体也保持合适大小。
 * - 移动:**严格沿安全区域的矩形周长行走**(拐角转弯,不横穿),rAF 逐帧推进;
 *   安全区域避开顶栏 / 侧边导航 / 右侧应用栏。
 * - 对话:轮询 luminari 生成的「生灵互相对话」(每 ~2 分钟换一段),按顺序轮流冒泡;
 *   拉取失败则退回各自的一句 say。窄屏(≤820px)不渲染。
 */

const NARROW = "(max-width: 820px)";
const W_BOX = 144; // 水平占地(生灵本体宽)
const H_BOX = 168; // 垂直占地(本体 + 名字行)
const M = 6; // 贴边留白
const DAY_MS = 24 * 60 * 60 * 1000; // 现实一天
const FILL = 0.76; // 生灵占画框比例(越大越填满)
const MIN_SCALE = 0.82; // 幼体尺寸下限
const TURN_MS = 7000; // 每句对话显示的时长

interface FieldCreature {
  id: string;
  name: string | null;
  total: number | null;
  say: string | null;
  img: string;
  mine: boolean;
  createdAt?: string | number;
  blueprint?: CreatureBlueprint;
}

interface Turn {
  id: string;
  text: string;
}

export function LuminariFloats({
  refreshMs = 5 * 60 * 1000,
  dismissable = false,
}: {
  refreshMs?: number;
  dismissable?: boolean;
}) {
  const [items, setItems] = useState<FieldCreature[]>(() => readFieldCache());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnIdx, setTurnIdx] = useState(0);
  const [narrow, setNarrow] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [hidden, setHidden] = useState<boolean>(() => readFloatsHidden());

  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const trackRef = useRef<Record<string, number>>({}); // 沿周长的距离
  const spdRef = useRef<Record<string, number>>({}); // 每秒前进的像素(带方向)

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // 显隐偏好由嵌入的「生灵」应用经 postMessage 远程设置(见 floats-pref / AppPanel),订阅其变化
  useEffect(() => subscribeFloatsHidden(setHidden), []);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/luminari/field", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        const list: FieldCreature[] = Array.isArray(data.items) ? data.items : [];
        if (alive && list.length) {
          setItems(list);
          writeFieldCache(list);
        }
      } catch {
        /* 静默:生灵层不可用不影响页面 */
      }
    };
    void pull();
    const t = setInterval(pull, refreshMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshMs]);

  // 生灵互相之间的对话:每 ~90s 拉一段新的(服务端 2 分钟缓存 + 防重复)
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/luminari/chatter", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (alive && Array.isArray(data.turns) && data.turns.length) {
          setTurns(data.turns);
          setTurnIdx(0);
        }
      } catch {
        /* 忽略 */
      }
    };
    void pull();
    const t = setInterval(pull, 90_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // 按顺序轮流冒泡
  useEffect(() => {
    if (!turns.length) return;
    const t = setInterval(() => setTurnIdx((i) => i + 1), TURN_MS);
    return () => clearInterval(t);
  }, [turns]);

  // 严格沿四周行走:rAF 逐帧推进每只的周长进度,直接写 DOM transform(不走 React 重渲染)
  useLayoutEffect(() => {
    if (narrow || hidden || !items.length) return;
    let raf = 0;

    const { x0, y0, x1, y1 } = pathRect();
    const P = 2 * (x1 - x0) + 2 * (y1 - y0);

    // 初始化(仅首次 / 新出现的):沿周长尽量打散,相邻间隔至少「两个气泡」
    const missing = items.filter(
      (it) => trackRef.current[it.id] === undefined || spdRef.current[it.id] === undefined,
    );
    if (missing.length) {
      const n = items.length;
      const seg = P / n;
      const minSep = Math.min(400, seg * 0.9);
      if (missing.length === n) {
        // 整圈等分 + 随机抖动,既打散又保证不挨太近
        const slots = shuffle(Array.from({ length: n }, (_, i) => i));
        const jitter = Math.max(0, (seg - minSep) / 2);
        items.forEach((it, i) => {
          const center = (slots[i] + 0.5) * seg;
          trackRef.current[it.id] = center + (Math.random() * 2 - 1) * jitter;
          spdRef.current[it.id] = randSpeed();
        });
      } else {
        // 增量新增:随机取点 + 拒绝采样,和已有生灵保持距离
        for (const it of missing) {
          let t = Math.random() * P;
          for (let k = 0; k < 40; k++) {
            const ok = items.every(
              (o) =>
                o.id === it.id ||
                trackRef.current[o.id] === undefined ||
                circDist(t, trackRef.current[o.id], P) >= minSep,
            );
            if (ok) break;
            t = Math.random() * P;
          }
          trackRef.current[it.id] = t;
          spdRef.current[it.id] = randSpeed();
        }
      }
    }

    const place = (dt: number) => {
      const r = pathRect();
      for (const it of items) {
        const node = nodeRefs.current[it.id];
        if (!node) continue;
        if (trackRef.current[it.id] === undefined) trackRef.current[it.id] = Math.random() * 4000;
        if (spdRef.current[it.id] === undefined) spdRef.current[it.id] = randSpeed();
        const t = trackRef.current[it.id] + spdRef.current[it.id] * dt;
        trackRef.current[it.id] = t;
        const p = pointOnPerimeter(t, r.x0, r.y0, r.x1, r.y1);
        node.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
        node.dataset.nearTop = p.y < 96 ? "1" : "0";
      }
    };

    place(0); // 立即落位,避免首帧停在 (0,0)
    let last = performance.now();
    const step = (now: number) => {
      place(Math.min(0.1, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [items, narrow, hidden]);

  const live = useMemo(() => {
    const m = new Map<string, { cc: ReturnType<typeof compileBlueprint>; matureDay: number }>();
    for (const it of items) {
      if (!it.blueprint) continue;
      const norm = normalizeBlueprint(it.blueprint);
      if (!norm) continue;
      try {
        m.set(it.id, { cc: compileBlueprint(norm), matureDay: norm.matureDay });
      } catch {
        /* 坏蓝图退回静态 PNG */
      }
    }
    return m;
  }, [items]);

  if (narrow || !items.length || (dismissable && hidden)) return null;

  const active = turns.length ? turns[turnIdx % turns.length] : null;

  return (
    <div className="cf-layer" aria-hidden>
      {items.map((it) => {
        const lc = live.get(it.id);
        const hovered = hover === it.id;
        const bubble = hovered ? it.say : active && active.id === it.id ? active.text : "";
        return (
          <div
            key={it.id}
            ref={(el) => {
              nodeRefs.current[it.id] = el;
            }}
            className={`cf-item${it.mine ? " is-mine" : ""}`}
            onMouseEnter={() => setHover(it.id)}
            onMouseLeave={() => setHover((h) => (h === it.id ? null : h))}
          >
            {bubble ? <div className="cf-bubble">{bubble}</div> : null}
            {lc ? (
              <div className="cf-live">
                <RigCreature
                  dna={lc.cc.dna}
                  rig={lc.cc.rig}
                  box={144}
                  matureDay={lc.matureDay}
                  minScale={MIN_SCALE}
                  fill={FILL}
                  daySource={() => fieldDay(it.createdAt, lc.matureDay)}
                />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cf-img" src={it.img} alt={it.name || ""} draggable={false} />
            )}
            <div className="cf-name">
              {it.name || "无名"}
              {typeof it.total === "number" ? <span className="cf-score">{it.total.toFixed(0)}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 「安全区域」:视口去掉顶栏 / 侧边导航栏 / 右侧应用栏后的可用矩形。
 * 运行时量取实际 DOM,兼容各布局(sidebar 的导航是 208px 左列;其余是顶部通栏)。
 */
function safeRect(): { left: number; top: number; right: number; bottom: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = M;
  let top = M;
  let right = vw - M;
  let bottom = vh - M;

  const bar = document.querySelector(".zx-topbar");
  if (bar) {
    const r = bar.getBoundingClientRect();
    if (r.width >= vw * 0.85) top = Math.max(top, r.bottom + M);
    else if (r.height >= vh * 0.85) left = Math.max(left, r.right + M);
  }

  const dock = document.querySelector(".zx-appdock");
  if (dock) {
    const r = dock.getBoundingClientRect();
    if (r.left > vw * 0.5) right = Math.min(right, r.left - M);
    else bottom = Math.min(bottom, r.top - M);
  }

  if (right - left < W_BOX + 16 || bottom - top < H_BOX + 16) {
    left = M;
    top = M;
    right = vw - M;
    bottom = vh - M;
  }
  return { left, top, right, bottom };
}

/** 把「沿周长的距离 d」映射到矩形(x0,y0)-(x1,y1)边上的一点,顺时针一圈。 */
function pointOnPerimeter(
  d: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number } {
  const Lx = x1 - x0;
  const Ly = y1 - y0;
  const P = 2 * (Lx + Ly);
  if (P <= 0) return { x: x0, y: y0 };
  d = ((d % P) + P) % P;
  if (d < Lx) return { x: x0 + d, y: y0 };
  d -= Lx;
  if (d < Ly) return { x: x1, y: y0 + d };
  d -= Ly;
  if (d < Lx) return { x: x1 - d, y: y1 };
  d -= Lx;
  return { x: x0, y: y1 - d };
}

/** 安全区域内、给生灵留下的行走矩形(左上角可落点范围) */
function pathRect(): { x0: number; y0: number; x1: number; y1: number } {
  const { left, top, right, bottom } = safeRect();
  const x0 = left;
  const y0 = top;
  const x1 = Math.max(x0, right - W_BOX);
  const y1 = Math.max(y0, bottom - H_BOX);
  return { x0, y0, x1, y1 };
}

/** Fisher–Yates 洗牌(用于打散初始站位,避免与 id 顺序相关) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 随机速度(带方向),14~30 px/s */
function randSpeed(): number {
  return (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 16);
}

/** 环形周长上两点的最短距离 */
function circDist(a: number, b: number, P: number): number {
  const d = Math.abs((((a - b) % P) + P) % P);
  return Math.min(d, P - d);
}

/** 现实时间驱动的年龄:出生到现在经过了多少天,封顶在 matureDay(不再长大) */
function fieldDay(createdAt: string | number | undefined, matureDay: number): number {
  const t0 = createdAt ? new Date(createdAt).getTime() : Date.now();
  const age = (Date.now() - t0) / DAY_MS;
  return Math.max(0, Math.min(matureDay, age));
}

/* ------------- 上次成功的四周层缓存(避免慢/空响应把整层弄没) ------------- */

// v2:缓存带上 blueprint —— 刷新首帧即可渲染活动的透明 SVG,不再先闪一下
// 带底色的静态 PNG(旧 v1 精简缓存即时失效)。
const FIELD_CACHE_KEY = "zx.luminari.field.v2";

function readFieldCache(): FieldCreature[] {
  if (typeof window === "undefined") return [];
  try {
    const s = localStorage.getItem(FIELD_CACHE_KEY);
    if (!s) return [];
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// 带上 blueprint:首帧就能编译出活的 RigCreature(透明 SVG),避免回退到带底色的静态
// PNG 闪一下(v1 精简掉了 blueprint,刷新必闪)。field 只回 Top5 + 本人参排(≤10 只),
// blueprint 每只约 2~3KB,合计远低于 localStorage 上限。
function writeFieldCache(list: FieldCreature[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FIELD_CACHE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
