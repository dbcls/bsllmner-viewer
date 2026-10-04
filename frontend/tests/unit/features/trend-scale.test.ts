import { describe, expect, it } from "vitest"

import { gridLines, gridStep, PLOT, showYearLabel, xForIndex, yForValue } from "~/features/workspace/trend/scale"

describe("xForIndex", () => {
  it("centers a single year in the plot", () => {
    expect(xForIndex(0, 1)).toBeCloseTo((PLOT.left + PLOT.right) / 2)
  })
})

describe("yForValue", () => {
  it("puts a value of zero at the bottom of the plot", () => {
    expect(yForValue(0, 100)).toBe(PLOT.bottom)
  })

  it("puts the maximum value at the top of the plot", () => {
    expect(yForValue(100, 100)).toBe(PLOT.top)
  })

  it("puts half of the maximum halfway between the top and the bottom of the plot", () => {
    expect(yForValue(50, 100)).toBeCloseTo((PLOT.top + PLOT.bottom) / 2)
  })

  it("puts a value at the bottom of the plot instead of dividing by zero when the maximum is zero", () => {
    expect(yForValue(0, 0)).toBe(PLOT.bottom)
  })
})

describe("gridStep", () => {
  it("never returns a fractional step", () => {
    expect(gridStep(12)).toBe(5)
    expect(Number.isInteger(gridStep(12.4))).toBe(true)
  })
})

describe("gridLines", () => {
  it("returns only the baseline when the maximum is zero", () => {
    expect(gridLines(0).map((line) => line.value)).toEqual([0])
  })

  it("puts higher values closer to the top of the plot", () => {
    const ys = gridLines(100).map((line) => line.y)
    expect(ys[0]).toBe(PLOT.bottom)
    expect(ys.at(-1)).toBe(PLOT.top)
    expect([...ys].sort((a, b) => b - a)).toEqual(ys)
  })
})

describe("showYearLabel", () => {
  it("shows every label when there are 20 years or fewer", () => {
    for (let count = 1; count <= 20; count++) {
      for (let index = 0; index < count; index++) expect(showYearLabel(index, count), `${index} of ${count}`).toBe(true)
    }
  })

  it("shows the label of the last year whatever the number of years", () => {
    for (let count = 1; count <= 60; count++) expect(showYearLabel(count - 1, count)).toBe(true)
  })
})
