import { describe, expect, it } from "vitest"

import { gridLines, PLOT, showYearLabel, xForIndex, yForValue, yMax } from "~/features/workspace/trend/scale"

describe("xForIndex", () => {
  it("singleYear_isCenteredInThePlot", () => {
    expect(xForIndex(0, 1)).toBeCloseTo((PLOT.left + PLOT.right) / 2)
  })

  it("multipleYears_putsFirstAndLastAtThePlotEdges", () => {
    expect(xForIndex(0, 5)).toBeCloseTo(PLOT.left)
    expect(xForIndex(4, 5)).toBeCloseTo(PLOT.right)
    expect(xForIndex(2, 5)).toBeCloseTo((PLOT.left + PLOT.right) / 2)
  })

  it("manyYears_spacesEveryStepEvenly", () => {
    const count = 37
    const step = (PLOT.right - PLOT.left) / (count - 1)
    for (let index = 0; index < count; index++) {
      expect(xForIndex(index, count)).toBeCloseTo(PLOT.left + index * step)
    }
  })
})

describe("yForValue", () => {
  it("zeroValue_sitsAtThePlotBottom", () => {
    expect(yForValue(0, 100)).toBe(PLOT.bottom)
  })

  it("maxValue_sitsAtThePlotTop", () => {
    expect(yForValue(100, 100)).toBe(PLOT.top)
  })

  it("halfOfMax_sitsHalfwayBetweenTopAndBottom", () => {
    expect(yForValue(50, 100)).toBeCloseTo((PLOT.top + PLOT.bottom) / 2)
  })

  it("zeroMax_sitsAtThePlotBottomInsteadOfDividingByZero", () => {
    expect(yForValue(0, 0)).toBe(PLOT.bottom)
  })
})

describe("yMax", () => {
  it("allZeroCounts_flooredAtOne", () => {
    expect(yMax([0, 0, 0])).toBe(1)
  })

  it("noCounts_flooredAtOne", () => {
    expect(yMax([])).toBe(1)
  })

  it("countsAboveOne_returnsTheLargest", () => {
    expect(yMax([3, 41, 7])).toBe(41)
  })
})

describe("gridLines", () => {
  it("returnsFiveLinesAtQuarterFractionsOfTheMaximum", () => {
    expect(gridLines(100).map((line) => line.value)).toEqual([0, 25, 50, 75, 100])
  })

  it("zeroMaximum_stillReturnsFiveLinesAllAtZero", () => {
    expect(gridLines(0).map((line) => line.value)).toEqual([0, 0, 0, 0, 0])
  })

  it("higherValues_sitCloserToThePlotTop", () => {
    const ys = gridLines(100).map((line) => line.y)
    expect(ys).toEqual([PLOT.bottom, yForValue(25, 100), yForValue(50, 100), yForValue(75, 100), PLOT.top])
  })
})

describe("showYearLabel", () => {
  it("twentyOrFewerYears_showsEveryLabel", () => {
    for (let index = 0; index < 20; index++) expect(showYearLabel(index, 20)).toBe(true)
  })

  it("moreThanTwentyYears_skipsOddIndices", () => {
    expect(showYearLabel(0, 25)).toBe(true)
    expect(showYearLabel(1, 25)).toBe(false)
    expect(showYearLabel(2, 25)).toBe(true)
    expect(showYearLabel(24, 25)).toBe(true)
  })
})
