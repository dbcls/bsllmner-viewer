import { describe, expect, it } from "vitest"

import { logPosition, mix, residualScale, residualScaleIsDark } from "~/lib/color"

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

describe("residualScale", () => {
  it("is neutral below 2 in magnitude and dark at 4 or more", () => {
    expect(residualScale(null)).toBe(residualScale(1.9))
    expect(residualScaleIsDark(-4)).toBe(true)
    expect(residualScaleIsDark(3.9)).toBe(false)
    expect(residualScale(-2)).not.toBe(residualScale(2))
  })
})
