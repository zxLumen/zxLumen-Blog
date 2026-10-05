"use client";

import { useEffect, useMemo, useState } from "react";
import { compileBlueprint, normalizeBlueprint } from "@zx/shared/creature";
import type { CreatureBlueprint } from "@zx/shared/creature";
import { RigCreature } from "@/components/lab/renderers/RigCreature";
import { MAX_DAY } from "@/components/lab/store";

/**
 * 四周生灵层(内联渲染,数据经同源代理 /api/luminari/field 取自 luminari)。
 *
 * 每只生灵是独立的 SVG DOM,悬浮在页面上;整层 pointer-events:none,
 * 只有单个生灵放行 hover/点击(悬停气泡),不影响主站内容与背景。
 * 位置来自服务端对话轮的归一化 pos,映射到视口四周;位移用 CSS 过渡做滑行。
 * 窄屏(≤820px)不渲染,避免遮挡内容。
 */

const NARROW = "(max-width: 820px)";
const BUBBLE_MS = 6000;

interface FieldCreature {
  id: string;
  name: string | null;
  total: number | null;
  say: string | null;
  img: string;
  pos: { x: number; y: number } | null;
  mine: boolean;
  blueprint?: CreatureBlueprint;
}

export function LuminariFloats({ refreshMs = 5 * 60 * 1000 }: { refreshMs?: number }) {
  const [items, setItems] = useState<FieldCreature[]>([]);
  const [narrow, setNarrow] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Record<string, boolean>>({});
  const [, setTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // 视口变化时重算贴边位置
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
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

  // 轮换气泡:每只每隔一会儿冒一次
  useEffect(() => {
    const timers: number[] = [];
    const timeouts: number[] = [];
    items.forEach((it, i) => {
      const t = window.setInterval(() => {
        setBubbles((b) => ({ ...b, [it.id]: true }));
        const to = window.setTimeout(() => setBubbles((b) => ({ ...b, [it.id]: false })), BUBBLE_MS);
        timeouts.push(to);
      }, 12000 + i * 2500);
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
        const p = it.pos ?? edgeFallback(it.id);
        const { x, y } = toViewport(p.x, p.y);
        const lc = live.get(it.id);
        const open = hover === it.id || bubbles[it.id];
        return (
          <div
            key={it.id}
            className={`cf-item${it.mine ? " is-mine" : ""}`}
            style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
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
                  daySource={() => fieldDay(it.id)}
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

const BOX = 120; // 生灵本体 96 + 名字行,贴边留白用

/** 把一个归一化点(0..1)贴到最近的一条视口边上,沿边自由分布(不限于四角)。 */
function toViewport(nx: number, ny: number): { x: number; y: number } {
  const m = 16;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const maxX = Math.max(m, w - BOX - m);
  const maxY = Math.max(m, h - BOX - m);
  const px = m + Math.min(1, Math.max(0, nx)) * (maxX - m);
  const py = m + Math.min(1, Math.max(0, ny)) * (maxY - m);
  const dL = px - m;
  const dR = maxX - px;
  const dT = py - m;
  const dB = maxY - py;
  const min = Math.min(dL, dR, dT, dB);
  if (min === dL) return { x: m, y: py };
  if (min === dR) return { x: maxX, y: py };
  if (min === dT) return { x: px, y: m };
  return { x: px, y: maxY };
}

/** 没有 pos 时的兜底:按 id 散到四周任意位置(贴边,不限于四角)。 */
function edgeFallback(id: string): { x: number; y: number } {
  const t = hash01(id) * 4;
  if (t < 1) return { x: t, y: 0 };
  if (t < 2) return { x: 1, y: t - 1 };
  if (t < 3) return { x: 1 - (t - 2), y: 1 };
  return { x: 0, y: 1 - (t - 3) };
}

/** 一只生灵跑完「幼体 → 成年」的循环时长(毫秒) */
const CYCLE_MS = 16000;

/** 每只按 id 错开相位,避免所有生灵同步长大 */
function hash01(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/** 四周层自跑的天数:在 0..MAX_DAY 间循环,驱动「循环长大 + 持续动作」 */
function fieldDay(id: string): number {
  const t = (performance.now() / CYCLE_MS + hash01(id)) % 1;
  return t * MAX_DAY;
}
