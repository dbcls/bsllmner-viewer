import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { crc32, setPngResolution } from "~/lib/png"

/** A 1 x 1 PNG written by an encoder: the signature, IHDR, IDAT, and IEND. */
const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>

describe("setPngResolution", () => {
  test.prop([fc.integer({ min: 1, max: 2000 })])("records dpi / 0.0254 pixels per meter on both axes, with the unit byte 1 and a valid CRC", (dpi) => {
    const out = setPngResolution(PIXEL, dpi)
    // The pHYs chunk follows the 8 byte signature and the 25 byte IHDR chunk.
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    expect(view.getUint32(33)).toBe(9)
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe("pHYs")
    const data = out.subarray(41, 50)
    expect(view.getUint32(41)).toBe(Math.round(dpi / 0.0254))
    expect(view.getUint32(45)).toBe(view.getUint32(41))
    expect(data[8]).toBe(1)
    expect(view.getUint32(50)).toBe(crc32(out.subarray(37, 50)))
  })

  test.prop([fc.integer({ min: 1, max: 2000 })])("keeps every byte of the original after the new chunk", (dpi) => {
    const out = setPngResolution(PIXEL, dpi)
    expect(out).toHaveLength(PIXEL.length + 21)
    expect(Array.from(out.subarray(0, 33))).toEqual(Array.from(PIXEL.subarray(0, 33)))
    expect(Array.from(out.subarray(54))).toEqual(Array.from(PIXEL.subarray(33)))
  })
})
