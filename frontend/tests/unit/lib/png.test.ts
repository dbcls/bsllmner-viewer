import { fc, test } from "@fast-check/vitest"
import { describe, expect, it } from "vitest"

import { crc32, physChunk, setPngResolution } from "~/lib/png"

/** A 1 x 1 PNG written by an encoder: the signature, IHDR, IDAT, and IEND. */
const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>

type Chunk = { type: string; data: Uint8Array; crc: number; checked: number }

const chunksOf = (png: Uint8Array): Chunk[] => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks: Chunk[] = []
  for (let offset = 8; offset < png.length; ) {
    const length = view.getUint32(offset)
    chunks.push({
      type: String.fromCharCode(...png.subarray(offset + 4, offset + 8)),
      data: png.subarray(offset + 8, offset + 8 + length),
      crc: view.getUint32(offset + 8 + length),
      checked: crc32(png.subarray(offset + 4, offset + 8 + length)),
    })
    offset += 12 + length
  }
  return chunks
}

describe("crc32", () => {
  it("gives the check values of the CRC-32 of PNG", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082)
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe("physChunk", () => {
  it("writes 72 dpi as the well-known chunk of 2835 pixels per meter", () => {
    expect(Array.from(physChunk(72))).toEqual([0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1, 0x00, 0x9a, 0x9c, 0x18])
  })
})

describe("setPngResolution", () => {
  it("puts one pHYs chunk right after IHDR and keeps the other chunks as they are", () => {
    const out = setPngResolution(PIXEL, 384)
    const before = chunksOf(PIXEL)
    const after = chunksOf(out)
    expect(after.map((c) => c.type)).toEqual(["IHDR", "pHYs", ...before.slice(1).map((c) => c.type)])
    for (const [index, chunk] of after.entries()) {
      expect(chunk.crc, chunk.type).toBe(chunk.checked)
      if (chunk.type !== "pHYs") expect(Array.from(chunk.data)).toEqual(Array.from((before.find((b) => b.type === chunk.type) ?? chunksOf(PIXEL)[index])?.data ?? []))
    }
  })

  it("replaces a pHYs chunk that the image has", () => {
    const once = setPngResolution(PIXEL, 96)
    const twice = setPngResolution(once, 384)
    expect(chunksOf(twice).filter((c) => c.type === "pHYs")).toHaveLength(1)
    const data = chunksOf(twice).find((c) => c.type === "pHYs")?.data as Uint8Array
    expect(new DataView(data.buffer, data.byteOffset).getUint32(0)).toBe(Math.round(384 / 0.0254))
  })

  it("returns bytes that are not a PNG as they are", () => {
    const text = new TextEncoder().encode("not a png at all, not a png at all") as Uint8Array<ArrayBuffer>
    expect(setPngResolution(text, 96)).toBe(text)
    const truncated = PIXEL.slice(0, 30)
    expect(setPngResolution(truncated, 96)).toEqual(truncated)
  })

  test.prop([fc.integer({ min: 1, max: 2000 })])("records dpi / 0.0254 pixels per meter on both axes, in meters, with the unit byte 1 and a valid CRC", (dpi) => {
    const chunk = chunksOf(setPngResolution(PIXEL, dpi)).find((c) => c.type === "pHYs") as Chunk
    const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength)
    expect(chunk.data).toHaveLength(9)
    expect(view.getUint32(0)).toBe(Math.round(dpi / 0.0254))
    expect(view.getUint32(4)).toBe(view.getUint32(0))
    expect(chunk.data[8]).toBe(1)
    expect(chunk.crc).toBe(chunk.checked)
  })

  test.prop([fc.integer({ min: 1, max: 2000 })])("keeps every byte of the original after the new chunk", (dpi) => {
    const out = setPngResolution(PIXEL, dpi)
    expect(out).toHaveLength(PIXEL.length + 21)
    expect(Array.from(out.subarray(0, 33))).toEqual(Array.from(PIXEL.subarray(0, 33)))
    expect(Array.from(out.subarray(54))).toEqual(Array.from(PIXEL.subarray(33)))
  })
})
