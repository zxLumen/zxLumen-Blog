"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compileBlueprint, normalizeBlueprint } from "@zx/shared/creature";
import { RigCreature } from "@zx/shared/renderers";
import { getLuminariApiBase } from "@/lib/luminari-embed";

const NARROW = "(max-width: 820px)";
const BUBBLE_MS = 6000;

interface FieldCreature {
  id: string;
  cid: string;
  name: string | null;
  total: number | null;
  say: string | null;
  img: string;
  pos: { x: number; y: number } | null;
  mine: boolean;
  selected: boolean;
  blueprint?: any;
}

interface Float {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  show: boolean;
}

export function LuminariFloats({ refreshMs = 5 * 60 * 1000 }: { refreshMs?: number }) {
  const [items, setItems] = useState<FieldCreature[]>([]);
  const [narrow, setNarrow] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const floats = useRef<Map<string, Float>>(new Map());
  const [, force] = useState(0);

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
    const base = getLuminariApiBase();
    const pull = async () => {
      try {
        const r = await fetch(`${base}/api/creatures/field`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        if (alive) setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        /* ignore */
      }
    };
    void pull();
    const t = setInterval(pull, refreshMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshMs]);

  useEffect(() => {
    const map = floats.current;
    for (const it of items) {
      const p = it.pos ?? edgeFallback(it.id);
      const { x, y } = toViewport(p.x, p.y);
      const cur = map.get(it.id);
      if (cur) {
        cur.tx = x;
        cur.ty = y;
      } else {
        map.set(it.id, { id: it.id, x, y, tx: x, ty: y, show: false });
      }
    }
    for (const key of [...map.keys()]) if (!items.some((i) => i.id === key)) map.delete(key);
    force((n) => n + 1);
  }, [items]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      let moved = false;
      for (const f of floats.current.values()) {
        const dx = f.tx - f.x;
        const dy = f.ty - f.y;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
          f.x += dx * 0.04;
          f.y += dy * 0.04;
          moved = true;
        }
      }
      if (moved) force((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    items.forEach((it, i) => {
      const t = window.setInterval(() => {
        const f = floats.current.get(it.id);
        if (!f) return;
        f.show = true;
        force((n) => n + 1);
        window.setTimeout(() => {
          f.show = false;
          force((n) => n + 1);
        }, BUBBLE_MS);
      }, 12000 + i * 2500);
      timers.push(t);
    });
    return () => timers.forEach(clearInterval);
  }, [items]);

  const live = useMemo(() => {
    const m = new Map<string, { dna: any; rig: any; matureDay: number }>();
    for (const it of items) {
      if (!it.blueprint) continue;
      const norm = normalizeBlueprint(it.blueprint);
      if (!norm) continue;
      try {
        const cc = compileBlueprint(norm);
        m.set(it.id, { dna: cc.dna, rig: cc.rig, matureDay: norm.matureDay });
      } catch {
        /* ignore */
      }
    }
    return m;
  }, [items]);

  if (narrow || !items.length) return null;

  return (
    <div className="cf-layer" aria-hidden>
      {items.map((it) => {
        const f = floats.current.get(it.id);
        if (!f) return null;
        const open = f.show || hover === it.id;
        return (
          <div
            key={it.id}
            className={`cf-item${it.mine ? " is-mine" : ""}`}
            style={{ transform: `translate3d(${f.x}px, ${f.y}px, 0)` }}
            onMouseEnter={() => setHover(it.id)}
            onMouseLeave={() => setHover((h) => (h === it.id ? null : h))}
          >
            {open && it.say && <div className="cf-bubble">{it.say}</div>}
            {live.has(it.id) ? (
              <div className="cf-live">
                <RigCreature
                  dna={live.get(it.id)!.dna}
                  rig={live.get(it.id)!.rig}
                  box={96}
                  matureDay={live.get(it.id)!.matureDay}
                />
              </div>
            ) : (
              <img className="cf-img" src={it.img} alt={it.name || ""} draggable={false} />
            )}
            <div className="cf-name">
              {it.name || "无名"}
              {typeof it.total === "number" && <span className="cf-score">{it.total.toFixed(0)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const BOX = 120;

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

function edgeFallback(id: string): { x: number; y: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const t = ((h % 1000) / 1000) * 4;
  if (t < 1) return { x: t, y: 0 };
  if (t < 2) return { x: 1, y: t - 1 };
  if (t < 3) return { x: 1 - (t - 2), y: 1 };
  return { x: 0, y: 1 - (t - 3) };
}
