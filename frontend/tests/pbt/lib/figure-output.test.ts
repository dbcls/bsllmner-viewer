import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { PNG_SCALE, pngScale } from "~/lib/export"
import { usedFaces } from "~/lib/figure-fonts"
import { cut } from "~/lib/figure-style"

describe("pngScale", () => {
  const reaches = (value: number, limit: number) => value >= limit * (1 - 1e-9)

  test.prop([fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1, max: 100_000 })])(
    "is 4, or the largest scale at which the canvas stays inside its side and area limits",
    (width, height) => {
      const scale = pngScale(width, height)
      expect(scale === PNG_SCALE || reaches(Math.max(width, height) * scale, 16384) || reaches(width * height * scale * scale, 268_435_456)).toBe(true)
      expect(scale).toBeLessThanOrEqual(PNG_SCALE)
      expect(scale).toBeGreaterThan(0)
      expect(Math.floor(width * scale)).toBeLessThanOrEqual(16384)
      expect(Math.floor(height * scale)).toBeLessThanOrEqual(16384)
      expect(Math.floor(width * scale) * Math.floor(height * scale)).toBeLessThanOrEqual(268_435_456)
    },
  )
})

describe("cut", () => {
  test.prop([fc.string({ unit: "binary" }), fc.integer({ min: 2, max: 40 })])(
    "returns at most the length, ends a cut label with an ellipsis after the start of the label, and keeps a short one",
    (label, length) => {
      const out = cut(label, length)
      expect(Array.from(out).length).toBeLessThanOrEqual(length)
      if (Array.from(label).length <= length) {
        expect(out).toBe(label)
      } else {
        expect(out.endsWith("…")).toBe(true)
        expect(Array.from(out)).toHaveLength(length)
        expect(label.startsWith(out.slice(0, -1))).toBe(true)
      }
    },
  )
})

describe("usedFaces", () => {
  const names = (svg: string) => usedFaces(svg).map((f) => `${f.family} ${f.weight}`)

  const family = fc.constantFrom("Public Sans, sans-serif", "IBM Plex Mono, monospace")
  const weight = fc.constantFrom(400, 500, 600)
  const drawn = fc.array(fc.record({ family, weight, nested: fc.boolean() }), { maxLength: 12 })

  test.prop([drawn])("finds exactly the families and weights that the texts set, whether set on a text or on a tspan in it", (items) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-family="Public Sans, sans-serif">${items
      .map((item) => {
        const attributes = `font-family="${item.family}" font-weight="${item.weight}"`
        return item.nested ? `<text font-weight="${item.weight}">a<tspan font-family="${item.family}">b</tspan></text>` : `<text ${attributes}>a</text>`
      })
      .join("")}</svg>`
    const expected = new Set(items.map((item) => `${item.family.startsWith("IBM") ? "IBM Plex Mono" : "Public Sans"} ${item.weight}`))
    // A nested text sets the weight on the text and the family on the tspan, so the text itself uses the default
    // family, Public Sans.
    for (const item of items) if (item.nested) expected.add(`Public Sans ${item.weight}`)
    expect(new Set(names(svg))).toEqual(expected)
  })
})

