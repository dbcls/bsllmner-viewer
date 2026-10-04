import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { contrastRatio, COUNT_SCALE_STOPS, countScale, logPosition, mix, RATIO_STEPS, ratioScale, ratioScaleIsDark, token } from "~/lib/color"

describe("token", () => {
  it("falls back to the value of the stylesheet for each color token that it has a fallback for", () => {
    const css = readFileSync(resolve(process.cwd(), "app/styles/tailwind.css"), "utf8")
    const checked: string[] = []
    for (const [, name = "", value = ""] of css.matchAll(/(--color-[a-z-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
      // A token without a fallback resolves to black.
      if (token(name) === "#000000") continue
      expect(token(name).toLowerCase(), name).toBe(value.toLowerCase())
      checked.push(name)
    }
    expect(checked).toEqual(expect.arrayContaining(["--color-surface", "--color-ink", "--color-brand-soft", "--color-brand-light", "--color-brand-deeper"]))
  })
})

describe("countScale", () => {
  it("gives the surface color for a position of 0 or less", () => {
    expect(countScale(0)).toBe(token("--color-surface"))
    expect(countScale(-0.5)).toBe(token("--color-surface"))
  })

  it("gives the color of each stop above 0 at the position of the stop", () => {
    for (const stop of COUNT_SCALE_STOPS.filter((s) => s.at > 0)) {
      expect(contrastRatio(countScale(stop.at), token(stop.token)), stop.token).toBeCloseTo(1, 5)
    }
  })
})

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

  it("darkens above half, from twice, and from four times the expected count", () => {
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
