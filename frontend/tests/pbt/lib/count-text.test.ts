import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { contrastRatio, countScale, countScaleIsDark, token } from "~/lib/color"

const position = fc.double({ min: 0, max: 1, noNaN: true })

describe("countScaleIsDark", () => {
  test.prop([position])("keeps the contrast of the text on every step of the scale at 4.2:1 or more", (t) => {
    const background = countScale(t)
    const text = countScaleIsDark(t) ? token("--color-surface") : token("--color-ink")
    expect(contrastRatio(background, text)).toBeGreaterThanOrEqual(4.2)
  })
})

describe("contrastRatio", () => {
  test.prop([fc.integer({ min: 0, max: 0xffffff })])("is 1 for a color against itself and at most 21", (value) => {
    const hex = `#${value.toString(16).padStart(6, "0")}`
    expect(contrastRatio(hex, hex)).toBeCloseTo(1)
    expect(contrastRatio(hex, "#000000")).toBeLessThanOrEqual(21)
  })

  test.prop([fc.integer({ min: 0, max: 255 })])("reads an rgb() color as the same hex color", (channel) => {
    const hex = `#${channel.toString(16).padStart(2, "0").repeat(3)}`
    expect(contrastRatio(`rgb(${channel}, ${channel}, ${channel})`, "#ffffff")).toBeCloseTo(contrastRatio(hex, "#ffffff"))
  })
})
