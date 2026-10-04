import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { formatSize } from "~/lib/format"

const UNIT_BYTES: Record<string, number> = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }

/** The bytes that a text of formatSize stands for. */
const parse = (text: string): number => {
  const [number = "", unit = ""] = text.split(" ")
  return Number(number.replaceAll(",", "")) * (UNIT_BYTES[unit] ?? Number.NaN)
}

describe("formatSize", () => {
  test.prop([fc.double({ min: 1000, max: 1e16, noNaN: true })])("stands for the size within 5%, with at most two significant digits below 1,000 TB", (bytes) => {
    const text = formatSize(bytes)
    expect(Math.abs(parse(text) - bytes) / bytes).toBeLessThanOrEqual(0.05)
    expect(text).toMatch(/^([1-9]\.\d|[1-9]\d?|[1-9]\d0) (KB|MB|GB|TB)$|^[1-9]\d{0,2}(,\d{3})+ TB$/)
  })

  test.prop([fc.double({ min: 0, max: 1e16, noNaN: true }), fc.double({ min: 0, max: 1e16, noNaN: true })])("never gives the larger size a smaller text", (a, b) => {
    const [small, large] = a <= b ? [a, b] : [b, a]
    const read = (text: string) => (text === "<1 KB" ? 0 : parse(text))
    expect(read(formatSize(small))).toBeLessThanOrEqual(read(formatSize(large)))
  })
})
