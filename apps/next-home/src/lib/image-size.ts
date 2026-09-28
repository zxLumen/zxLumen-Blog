/**
 * 从图片字节里读真实宽高(零依赖,按魔数解析,不信任声明的 MIME)。
 * 上传接口用它挡掉「改了后缀的假图片」,并拿到尺寸做「图与视频方向是否一致」的提示。
 * 与 packages/shared/scripts/vlog-cover.mjs 里的同名函数保持一致(改一处记得同步另一处)。
 */
export interface ImageSize {
  width: number
  height: number
  type: 'jpeg' | 'png' | 'webp'
}

export function imageSize(buf: Buffer): ImageSize | null {
  if (buf.length < 24) return null
  // PNG: 89 50 4E 47 ... IHDR 宽高在 16/20
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: 'png' }
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16)
    if (fourcc === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, type: 'webp' }
    }
    if (fourcc === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, type: 'webp' }
    }
    if (fourcc === 'VP8X') {
      const w = buf[24] | (buf[25] << 8) | (buf[26] << 16)
      const h = buf[27] | (buf[28] << 8) | (buf[29] << 16)
      return { width: w + 1, height: h + 1, type: 'webp' }
    }
    return null
  }
  // JPEG: 逐段走,SOF0..SOF15 里排除 DHT(C4) / JPG(C8) / DAC(CC)
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    // 段结构:FF Cx | 长度(2B,含长度本身) | 精度(1B) | 高(2B) | 宽(2B)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), type: 'jpeg' }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}
