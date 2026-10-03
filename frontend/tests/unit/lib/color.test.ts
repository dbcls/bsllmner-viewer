import { describe, expect, it } from "vitest"

import { logPosition, mix, RATIO_STEPS, ratioScale, ratioScaleIsDark } from "~/lib/color"

describe("logPosition", () => {
  it("maps zero and non-positive to 0 and the maximum to 1", () => {
    expect(logPosition(0, 100)).toBe(0)
    expect(logPosition(-5, 100)).toBe(0)
    expect(logPosition(100, 100)).toBeCloseTo(1)
    expect(logPosition(10, 100)).toBeGreaterThan(0.5)
  })
})

describe("mix", () => {
  it("interpolates between two hex colors and clamps t", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("rgb(128, 128, 128)")
    expect(mix("#000000", "#ffffff", 2)).toBe("rgb(255, 255, 255)")
    expect(mix("#fff", "#000", 0)).toBe("rgb(255, 255, 255)")
  })
})

describe("ratioScale", () => {
  it("leaves half or less of the expected count, and a cell without a ratio, uncolored", () => {
    const neutral = ratioScale(null)
    expect(ratioScale(0)).toBe(neutral)
    expect(ratioScale(0.5)).toBe(neutral)
    expect(ratioScale(0.501)).not.toBe(neutral)
  })

  it("darkens at half, twice, and four times the expected count", () => {
    const steps = [ratioScale(0.5), ratioScale(1), ratioScale(2), ratioScale(4)]
    expect(new Set(steps).size).toBe(4)
    expect(ratioScale(1.999)).toBe(ratioScale(1))
    expect(ratioScale(3.999)).toBe(ratioScale(2))
    expect(ratioScale(40)).toBe(ratioScale(4))
  })

  it("puts white text only on four times or more", () => {
    expect(ratioScaleIsDark(4)).toBe(true)
    expect(ratioScaleIsDark(3.99)).toBe(false)
    expect(ratioScaleIsDark(0)).toBe(false)
    expect(ratioScaleIsDark(null)).toBe(false)
  })
})

describe("RATIO_STEPS", () => {
  it("are the ratios at which ratioScale changes", () => {
    const { low, mid, high } = RATIO_STEPS
    expect(ratioScale(low)).not.toBe(ratioScale(low + 0.001))
    expect(ratioScale(mid - 0.001)).not.toBe(ratioScale(mid))
    expect(ratioScale(high - 0.001)).not.toBe(ratioScale(high))
  })
})
