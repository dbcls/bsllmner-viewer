import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { heatmapRows } from "~/features/workspace/heatmap/table"

describe("heatmapRows", () => {
  const rows = [{ value: "r1", label: "R one", count: 10 }]
  const cols = [{ value: "c1", label: "C one", count: 7 }]

  test.prop([fc.double({ noNaN: true, noDefaultInfinity: true }), fc.nat()])("keeps the number of the api in the row", (expected, count) => {
    const [row] = heatmapRows(rows, cols, [{ row: "r1", col: "c1", count, expected, ratio: null, residual: null }], 1)
    expect(row?.[4]).toBe(count)
    expect(row?.[5]).toBe(expected)
    expect(row?.[6]).toBeNull()
  })
})
