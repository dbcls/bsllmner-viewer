import { describe, expect, it } from "vitest"

import { gridLines, gridStep, PLOT, showYearLabel, xForIndex, yForValue, yMax } from "~/features/workspace/trend/scale"

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

describe("gridStep", () => {
  it("smallCounts_useAStepOfOne", () => {
    expect(gridStep(1)).toBe(1)
    expect(gridStep(5)).toBe(1)
  })

  it("picksTheSmallestRoundStepWithinFiveIntervals", () => {
    expect(gridStep(6)).toBe(2)
    expect(gridStep(11)).toBe(5)
    expect(gridStep(26)).toBe(10)
    expect(gridStep(125)).toBe(25)
    expect(gridStep(126)).toBe(50)
    expect(gridStep(509_971)).toBe(200_000)
  })

  it("neverReturnsAFractionalStep", () => {
    expect(gridStep(12)).toBe(5)
    expect(Number.isInteger(gridStep(12.4))).toBe(true)
  })
})

describe("yMax", () => {
  it("allZeroCounts_flooredAtOne", () => {
    expect(yMax([0, 0, 0])).toBe(1)
  })

  it("noCounts_flooredAtOne", () => {
    expect(yMax([])).toBe(1)
  })

  it("roundsTheLargestCountUpToAGridLine", () => {
    expect(yMax([3, 41, 7])).toBe(50)
    expect(yMax([509_971])).toBe(600_000)
    expect(yMax([1_466])).toBe(1_500)
  })

  it("aCountOnAGridLine_isItsOwnMaximum", () => {
    expect(yMax([100])).toBe(100)
    expect(yMax([5])).toBe(5)
  })
})

describe("gridLines", () => {
  it("returnsOneLinePerStepFromZeroToTheMaximum", () => {
    expect(gridLines(100).map((line) => line.value)).toEqual([0, 20, 40, 60, 80, 100])
    expect(gridLines(600_000).map((line) => line.value)).toEqual([0, 200_000, 400_000, 600_000])
    expect(gridLines(1).map((line) => line.value)).toEqual([0, 1])
  })

  it("zeroMaximum_returnsOnlyTheBaseline", () => {
    expect(gridLines(0).map((line) => line.value)).toEqual([0])
  })

  it("higherValues_sitCloserToThePlotTop", () => {
    const ys = gridLines(100).map((line) => line.y)
    expect(ys[0]).toBe(PLOT.bottom)
    expect(ys.at(-1)).toBe(PLOT.top)
    expect([...ys].sort((a, b) => b - a)).toEqual(ys)
  })
})

describe("showYearLabel", () => {
  it("twentyOrFewerYears_showsEveryLabel", () => {
    for (let index = 0; index < 20; index++) expect(showYearLabel(index, 20)).toBe(true)
  })

  it("shows the label of the last year whatever the number of years", () => {
    for (let count = 1; count <= 60; count++) expect(showYearLabel(count - 1, count)).toBe(true)
  })

  it("skips every other label counted back from the last year when there are more than twenty years", () => {
    // 22 years: the last label is index 21, so the even indices are the ones that are skipped.
    const shown = Array.from({ length: 22 }, (_, index) => showYearLabel(index, 22))
    expect(shown.map((on, index) => (on ? index : -1)).filter((index) => index >= 0)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21])
    // 25 years: the first label is shown too.
    expect(showYearLabel(0, 25)).toBe(true)
    expect(showYearLabel(1, 25)).toBe(false)
    expect(showYearLabel(24, 25)).toBe(true)
  })
})
