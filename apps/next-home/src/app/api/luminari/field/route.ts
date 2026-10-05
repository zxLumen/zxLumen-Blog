import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 同源代理:把 luminari 的四周生灵层(/api/creatures/field)转发给浏览器。
 *
 * 为什么要代理:浏览器直接跨域请求 luminari 会被 CORS 拦(luminari 未开 CORS)。
 * 代理后浏览器只访问本站同源路径,无需改 luminari、无需 CORS 白名单。
 *
 * 地址解析:
 * - 服务端到 luminari:LUMINARI_INTERNAL_URL > dev 用 127.0.0.1:8790 > 生产用容器名 luminari:8790
 * - 图片回退用绝对地址:LUMINARI_PUBLIC_URL > dev 用 localhost:8790 > 生产 https://luminari.${DOMAIN}
 */

function internalBase(): string {
  if (process.env.LUMINARI_INTERNAL_URL) return process.env.LUMINARI_INTERNAL_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8790";
  return "http://luminari:8790";
}

function publicBase(): string {
  if (process.env.LUMINARI_PUBLIC_URL) return process.env.LUMINARI_PUBLIC_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:8790";
  const domain = process.env.DOMAIN || process.env.NEXT_PUBLIC_DOMAIN || "zxlumen.cn";
  return `https://luminari.${domain}`;
}

export async function GET() {
  try {
    const r = await fetch(`${internalBase()}/api/creatures/field`, { cache: "no-store" });
    if (!r.ok) return NextResponse.json({ items: [] });
    const data = (await r.json()) as { items?: unknown };
    const pub = publicBase();
    const items = Array.isArray(data.items)
      ? data.items.map((it) => {
          if (it && typeof it === "object" && typeof (it as { img?: unknown }).img === "string") {
            const img = (it as { img: string }).img;
            return { ...(it as object), img: img.startsWith("/") ? `${pub}${img}` : img };
          }
          return it;
        })
      : [];
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
