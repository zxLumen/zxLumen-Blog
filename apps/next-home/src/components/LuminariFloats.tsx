"use client";

import { useEffect, useMemo, useState } from "react";
import { compileBlueprint, normalizeBlueprint } from "@zx/shared/creature";
import type { CreatureBlueprint } from "@zx/shared/creature";
import { RigCreature } from "@/components/lab/renderers/RigCreature";

/**
 * 四周生灵层(内联渲染,数据经同源代理 /api/luminari/field 取自 luminari)。
 *
 * - 每只生灵是独立的 SVG DOM,悬浮在页面上;整层 pointer-events:none,
 *   只有单个生灵放行 hover/点击(悬停气泡),不影响主站内容与背景。
 * - 成长按**现实时间**:现实一天 = 生灵长一天,在 0..matureDay(约 30)间循环。
 * - 移动:在「安全区域」(避开顶栏 / 侧边导航 / 右侧应用栏)内的四周随机游走,
 *   每只每 ~6 秒换一个贴边目标点,用 CSS 过渡平滑滑行;每次刷新位置随机。
 * - 窄屏(≤820px)不渲染,避免遮挡内容。
 */

const NARROW = "(max-width: 820px)";
const BUBBLE_MS = 6000;
const ROAM_MS = 6000; // 换目标点的间隔;与 CSS 的 transform 过渡时长匹配
const BOX = 120; // 生灵本体 96 + 名字行,贴边留白用
const EDGE_JITTER = 44; // 沿边游走时向内的随机抖动
const DAY_MS = 24 * 60 * 60 * 1000; // 现实一天

interface FieldCreature {
  id: string;
  name: string | null;
  total: number | null;
  say: string | null;
  img: string;
  mine: boolean;
  blueprint?: CreatureBlueprint;
}

export function LuminariFloats({ refreshMs = 5 * 60 * 1000 }: { refreshMs?: number }) {
  const [items, setItems] = useState<FieldCreature[]>([]);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [narrow, setNarrow] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Record<string, boolean>>({});

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
        const list: FieldCreature[] = Array.isArray(data.items) ? data.items : [];
        if (!alive) return;
        setItems(list);
        // 新出现的生灵给一个随机的贴边位置;消失的清掉
        setPos((prev) => {
          const next: Record<string, { x: number; y: number }> = {};
          for (const it of list) next[it.id] = prev[it.id] ?? randomEdgePoint();
          return next;
        });
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

  // 自主游走:每只每隔一会儿换一个贴边目标点,用 CSS 过渡滑过去
  useEffect(() => {
    if (narrow || !items.length) return;
    const timers = items.map((it, i) =>
      window.setInterval(
        () => setPos((prev) => ({ ...prev, [it.id]: randomEdgePoint() })),
        ROAM_MS + i * 800,
      ),
    );
    return () => timers.forEach(clearInterval);
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
        const p = pos[it.id];
        if (!p) return null;
        const lc = live.get(it.id);
        const open = hover === it.id || bubbles[it.id];
        return (
          <div
            key={it.id}
            className={`cf-item${it.mine ? " is-mine" : ""}`}
            style={{ transform: `translate3d(${p.x}px, ${p.y}px, 0)` }}
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
                  daySource={() => fieldDay(it.id, lc.matureDay)}
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

  // 兜底:安全区域过小(极窄/量取失败)时退回整屏内缩
  if (right - left < BOX + 16 || bottom - top < BOX + 16) {
    left = 8;
    top = 8;
    right = vw - 8;
    bottom = vh - 8;
  }
  return { left, top, right, bottom };
}

/** 在安全区域「四周」随机取一个贴边点(向内带一点抖动)。 */
function randomEdgePoint(): { x: number; y: number } {
  const { left, top, right, bottom } = safeRect();
  const maxX = Math.max(left, right - BOX);
  const maxY = Math.max(top, bottom - BOX);
  const jx = Math.min(EDGE_JITTER, (maxX - left) / 2);
  const jy = Math.min(EDGE_JITTER, (maxY - top) / 2);
  const rnd = (n: number) => Math.random() * n;
  switch (Math.floor(Math.random() * 4)) {
    case 0:
      return { x: left + rnd(maxX - left), y: top + rnd(jy) };
    case 1:
      return { x: maxX - rnd(jx), y: top + rnd(maxY - top) };
    case 2:
      return { x: left + rnd(maxX - left), y: maxY - rnd(jy) };
    default:
      return { x: left + rnd(jx), y: top + rnd(maxY - top) };
  }
}

/** 每只按 id 错开相位,避免所有生灵同步长大 */
function hash01(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/** 现实时间驱动的天数:现实一天 = 长一天,在 0..matureDay 间循环 */
function fieldDay(id: string, matureDay: number): number {
  const d = Date.now() / DAY_MS + hash01(id) * matureDay;
  return d % matureDay;
}
