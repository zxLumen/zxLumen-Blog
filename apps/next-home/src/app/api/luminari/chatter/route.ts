import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 同源代理:转发 luminari 的生灵对话(/api/creatures/chatter)。地址解析同 field。 */
function internalBase(): string {
  if (process.env.LUMINARI_INTERNAL_URL) return process.env.LUMINARI_INTERNAL_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8790";
  return "http://luminari:8790";
}

export async function GET() {
  try {
    const r = await fetch(`${internalBase()}/api/creatures/chatter`, { cache: "no-store" });
    if (!r.ok) return NextResponse.json({ turns: [] });
    const data = (await r.json()) as { turns?: unknown };
    return NextResponse.json({ turns: Array.isArray(data.turns) ? data.turns : [] });
  } catch {
    return NextResponse.json({ turns: [] });
  }
}
