import { describe, expect, it } from "vitest"

import { distributionRows, WITHOUT_TERM_LABEL } from "~/features/workspace/distribution/table"
import { heatmapRows } from "~/features/workspace/heatmap/table"

describe("distributionRows", () => {
  it("writes the elements, the part without a term, and the total, with the values as they are", () => {
    const rows = distributionRows([{ value: "MONDO:1", label: "asthma", count: 1234567 }], 12, 2000000)
    expect(rows).toEqual([
      ["MONDO:1", "asthma", 1234567],
      ["", WITHOUT_TERM_LABEL, 12],
      ["", "Total", 2000000],
    ])
  })

  it("omits the row without a term when the field has none", () => {
    expect(distributionRows([], null, 5)).toEqual([["", "Total", 5]])
    expect(distributionRows([], undefined, 5)).toEqual([["", "Total", 5]])
    expect(distributionRows([], 0, 5)).toHaveLength(2)
  })
})

describe("heatmapRows", () => {
  const rows = [{ value: "r1", label: "R one", count: 10 }]
  const cols = [{ value: "c1", label: "C one", count: 7 }]

  it("writes the unrounded values and the totals of the row, the column, and the table on each row", () => {
    const cell = { row: "r1", col: "c1", count: 3, expected: 200.9234, ratio: 0.93612345, residual: -13.58123, classification: "under" }
    expect(heatmapRows(rows, cols, [cell], 50)).toEqual([["r1", "R one", "c1", "C one", 3, 200.9234, 0.93612345, -13.58123, "under", 10, 7, 50]])
  })
})
