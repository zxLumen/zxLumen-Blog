export function getLuminariApiBase(): string {
  if (typeof process !== "undefined" && process.env.LUMINARI_API_BASE) {
    return process.env.LUMINARI_API_BASE;
  }
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:8790";
  }
  const domain = process.env.NEXT_PUBLIC_DOMAIN || "zxlumen.cn";
  return `https://luminari.${domain}`;
}

export function getLuminariEmbedUrl(): string | null {
  if (process.env.LUMINARI_EMBED === "0") return null;
  if (process.env.LUMINARI_EMBED_URL) return process.env.LUMINARI_EMBED_URL;
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "http://localhost:8790/embed.html";
  }
  const domain = process.env.NEXT_PUBLIC_DOMAIN || "zxlumen.cn";
  return `https://luminari.${domain}/embed.html`;
}
