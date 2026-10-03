/** Reading and writing the chunks of a PNG file: enough to record the resolution of an image. */

const SIGNATURE_LENGTH = 8
const INCHES_PER_METER = 39.37007874015748

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** The CRC-32 of the bytes, as the PNG format defines it. */
export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** The `pHYs` chunk for `dpi` dots per inch on both axes, in pixels per meter. */
export const physChunk = (dpi: number): Uint8Array => {
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  const perMeter = Math.round(dpi * INCHES_PER_METER)
  view.setUint32(0, perMeter)
  view.setUint32(4, perMeter)
  data[8] = 1
  return chunk("pHYs", data)
}

const typeOf = (bytes: Uint8Array, offset: number): string => String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))

/**
 * The PNG with its resolution set to `dpi`: a `pHYs` chunk right after the header chunk, in place of any that the image
 * has. Bytes that are not a PNG are returned as they are.
 */
export const setPngResolution = (png: Uint8Array<ArrayBuffer>, dpi: number): Uint8Array<ArrayBuffer> => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const isPng = png.length >= SIGNATURE_LENGTH + 12 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => png[index] === byte)
  if (!isPng || typeOf(png, SIGNATURE_LENGTH) !== "IHDR") return png
  const parts: Uint8Array[] = [png.subarray(0, SIGNATURE_LENGTH)]
  let offset = SIGNATURE_LENGTH
  let inserted = false
  while (offset + 12 <= png.length) {
    const end = offset + 12 + view.getUint32(offset)
    if (end > png.length) return png
    if (typeOf(png, offset) !== "pHYs") parts.push(png.subarray(offset, end))
    if (!inserted) {
      parts.push(physChunk(dpi))
      inserted = true
    }
    offset = end
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
