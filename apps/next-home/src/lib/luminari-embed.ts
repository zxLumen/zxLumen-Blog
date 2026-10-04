/**
 * 主站嵌入「四周生灵层」的 iframe 地址(luminari 的 embed.html)。
 *
 * 生产走子域 `luminari.${DOMAIN}/embed.html`;本地开发走 luminari dev 端口。
 * 可用 `LUMINARI_EMBED_URL` 覆盖、`LUMINARI_EMBED=0` 关闭(返回 null,不渲染)。
 */
export function getLuminariEmbedUrl(): string | null {
  if (process.env.LUMINARI_EMBED === "0") return null;
  const explicit = process.env.LUMINARI_EMBED_URL?.trim();
  if (explicit) return explicit;
  const domain = process.env.DOMAIN || "zxlumen.cn";
  return process.env.NODE_ENV === "production"
    ? `https://luminari.${domain}/embed.html`
    : "http://localhost:8790/embed.html";
}
