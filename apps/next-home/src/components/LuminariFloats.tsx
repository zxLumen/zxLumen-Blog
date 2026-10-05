"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compileBlueprint, normalizeBlueprint } from "@zx/shared/creature";
import type { CreatureBlueprint } from "@zx/shared/creature";
import { RigCreature } from "@/components/lab/renderers/RigCreature";

/**
 * 四周生灵层(内联渲染,数据经同源代理 /api/luminari/field 取自 luminari)。
 *
 * - 每只生灵是独立的 SVG DOM,悬浮在页面上;整层 pointer-events:none,
 *   只有单个生灵放行 hover/点击(悬停气泡),不影响主站内容与背景。
 * - 成长按**出生时间**算真实年龄:现实一天 = 长一天,从 0 长到 matureDay(约 30),
 *   之后维持成年形态;太小的会套一个尺寸下限(minScale),不至于小到看不见。
 * - 移动:**严格沿安全区域的矩形周长行走**(拐角转弯,不横穿中间),rAF 逐帧推进;
 *   安全区域避开了顶栏 / 侧边导航 / 右侧应用栏,不会被遮挡。
 * - 窄屏(≤820px)不渲染,避免遮挡内容。
 */

const NARROW = "(max-width: 820px)";
const BUBBLE_MS = 6000;
const BOX = 120; // 生灵本体 96 + 名字行,贴边留白用
const DAY_MS = 24 * 60 * 60 * 1000; // 现实一天
const MIN_SCALE = 0.85; // 尺寸下限(幼体不至于太小)

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

export function LuminariFloats({ refreshMs = 5 * 60 * 1000 }: { refreshMs?: number }) {
  const [items, setItems] = useState<FieldCreature[]>([]);
  const [narrow, setNarrow] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/luminari/field", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        if (alive) setItems(Array.isArray(data.items) ? data.items : []);
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

  // 严格沿四周行走:rAF 逐帧推进每只的周长进度,直接写 DOM transform(不走 React 重渲染)
  useLayoutEffect(() => {
    if (narrow || !items.length) return;
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { left, top, right, bottom } = safeRect();
      const x0 = left;
      const y0 = top;
      const x1 = Math.max(x0, right - BOX);
      const y1 = Math.max(y0, bottom - BOX);
      for (const it of items) {
        const node = nodeRefs.current[it.id];
        if (!node) continue;
        let t = trackRef.current[it.id];
        if (t === undefined || spdRef.current[it.id] === undefined) {
          t = hash01(it.id) * 4000;
          trackRef.current[it.id] = t;
          const dir = hash01(it.id + "d") < 0.5 ? -1 : 1;
          spdRef.current[it.id] = dir * (14 + hash01(it.id + "s") * 16); // 14~30 px/s
        }
        t += spdRef.current[it.id] * dt;
        trackRef.current[it.id] = t;
        const p = pointOnPerimeter(t, x0, y0, x1, y1);
        node.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      }
      raf = requestAnimationFrame(step);
    };

    // 立即落位一次,避免首帧停在 (0,0)
    last = performance.now();
    const { left, top, right, bottom } = safeRect();
    for (const it of items) {
      const node = nodeRefs.current[it.id];
      if (!node) continue;
      if (trackRef.current[it.id] === undefined) {
        trackRef.current[it.id] = hash01(it.id) * 4000;
        const dir = hash01(it.id + "d") < 0.5 ? -1 : 1;
        spdRef.current[it.id] = dir * (14 + hash01(it.id + "s") * 16);
      }
      const x1 = Math.max(left, right - BOX);
      const y1 = Math.max(top, bottom - BOX);
      const p = pointOnPerimeter(trackRef.current[it.id], left, top, x1, y1);
      node.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [items, narrow]);

  // 轮换气泡:每只每隔一会儿冒一次
  useEffect(() => {
    const timers: number[] = [];
    const timeouts: number[] = [];
    items.forEach((it, i) => {
      const t = window.setInterval(() => {
        setBubbles((b) => ({ ...b, [it.id]: true }));
        const to = window.setTimeout(() => setBubbles((b) => ({ ...b, [it.id]: false })), BUBBLE_MS);
        timeouts.push(to);
      }, 9000 + i * 2500);
      timers.push(t);
    });
    return () => {
      timers.forEach(clearInterval);
      timeouts.forEach(clearTimeout);
    };
  }, [items]);

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

  if (narrow || !items.length) return null;

  return (
    <div className="cf-layer" aria-hidden>
      {items.map((it) => {
        const lc = live.get(it.id);
        const open = hover === it.id || bubbles[it.id];
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
            {open && it.say ? <div className="cf-bubble">{it.say}</div> : null}
            {lc ? (
              <div className="cf-live">
                <RigCreature
                  dna={lc.cc.dna}
                  rig={lc.cc.rig}
                  box={96}
                  matureDay={lc.matureDay}
                  minScale={MIN_SCALE}
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
  let left = 8;
  let top = 8;
  let right = vw - 8;
  let bottom = vh - 8;

  const bar = document.querySelector(".zx-topbar");
  if (bar) {
    const r = bar.getBoundingClientRect();
    if (r.width >= vw * 0.85) top = Math.max(top, r.bottom + 8);
    else if (r.height >= vh * 0.85) left = Math.max(left, r.right + 8);
  }

  const dock = document.querySelector(".zx-appdock");
  if (dock) {
    const r = dock.getBoundingClientRect();
    if (r.left > vw * 0.5) right = Math.min(right, r.left - 8);
    else bottom = Math.min(bottom, r.top - 8);
  }

  if (right - left < BOX + 16 || bottom - top < BOX + 16) {
    left = 8;
    top = 8;
    right = vw - 8;
    bottom = vh - 8;
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

/** 每只按 id 错开 */
function hash01(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/** 现实时间驱动的年龄:出生到现在经过了多少天,封顶在 matureDay(不再长大) */
function fieldDay(createdAt: string | number | undefined, matureDay: number): number {
  const t0 = createdAt ? new Date(createdAt).getTime() : Date.now();
  const age = (Date.now() - t0) / DAY_MS;
  return Math.max(0, Math.min(matureDay, age));
}
