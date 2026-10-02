import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { gridLines, gridStep, PLOT, yMax } from "~/features/workspace/trend/scale"

const counts = fc.array(fc.nat({ max: 50_000_000 }), { maxLength: 8 })

describe("trend scale", () => {
  test.prop([counts])("the axis maximum is a grid line at or above every count", (values) => {
    const max = yMax(values)
    const step = gridStep(max)
    expect(max).toBeGreaterThanOrEqual(Math.max(1, ...values))
    expect(Number.isInteger(max / step)).toBe(true)
    expect(max / step).toBeGreaterThanOrEqual(1)
    expect(max / step).toBeLessThanOrEqual(5)
  })

  test.prop([counts])("the axis maximum is less than one grid step above the largest count", (values) => {
    const largest = Math.max(1, ...values)
    const max = yMax(values)
    expect(max - largest).toBeLessThan(gridStep(largest))
  })

  test.prop([fc.integer({ min: 1, max: 50_000_000 })])("a step is 1, 2, 25, or 5 times a power of ten", (value) => {
    const digits = String(gridStep(value)).replace(/0+$/, "")
    expect(["1", "2", "25", "5"]).toContain(digits)
  })

  test.prop([counts])("grid lines are evenly spaced whole numbers from the baseline to the top of the plot", (values) => {
    const max = yMax(values)
    const lines = gridLines(max)
    const step = gridStep(max)
    expect(lines[0]).toEqual({ value: 0, y: PLOT.bottom })
    expect(lines.at(-1)?.value).toBe(max)
    expect(lines.at(-1)?.y).toBeCloseTo(PLOT.top)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.length).toBeLessThanOrEqual(6)
    lines.forEach((line, index) => expect(line.value).toBe(index * step))
  })
})
