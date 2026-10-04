import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { gridLines, gridStep, PLOT, showYearLabel, xForIndex, yMax } from "~/features/workspace/trend/scale"

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

  test.prop([fc.integer({ min: 1, max: 50_000_000 })])("a step is 1, 2, 2.5, or 5 times a power of ten", (value) => {
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

  test.prop([fc.integer({ min: 1, max: 50_000_000 })])("a step is the smallest whole round step that spans the count in at most five intervals", (value) => {
    const step = gridStep(value)
    expect(value / step).toBeLessThanOrEqual(5)
    for (let base = 1; base < step; base *= 10) {
      for (const factor of [1, 2, 2.5, 5]) {
        const smaller = base * factor
        if (Number.isInteger(smaller) && smaller < step) expect(value / smaller, `${smaller} is a smaller step for ${value}`).toBeGreaterThan(5)
      }
    }
  })

  test.prop([fc.integer({ min: 2, max: 200 })])("puts the first and the last year at the edges of the plot and spaces the years evenly", (count) => {
    const xs = Array.from({ length: count }, (_, index) => xForIndex(index, count))
    const step = (PLOT.right - PLOT.left) / (count - 1)
    expect(xs[0]).toBeCloseTo(PLOT.left)
    expect(xs.at(-1)).toBeCloseTo(PLOT.right)
    xs.slice(1).forEach((x, index) => expect(x - (xs[index] ?? 0)).toBeCloseTo(step))
  })

  test.prop([fc.integer({ min: 21, max: 200 })])("shows every other label when there are more than 20 years", (count) => {
    const shown = Array.from({ length: count }, (_, index) => showYearLabel(index, count))
    shown.slice(1).forEach((on, index) => expect(on).not.toBe(shown[index]))
  })
})
