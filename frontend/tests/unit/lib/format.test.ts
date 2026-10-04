import { describe, expect, it } from "vitest"

import { formatPercent, formatRatio } from "~/lib/format"

describe("formatRatio", () => {
  it("writes a cell without matches as 0 and a ratio below 0.01 as a bound", () => {
    expect(formatRatio(0)).toBe("0×")
    expect(formatRatio(0.0098)).toBe("<0.01×")
    expect(formatRatio(0.01)).toBe("0.010×")
  })

  it("keeps two significant digits from 0.01 to 10", () => {
    expect(formatRatio(0.0543)).toBe("0.054×")
    expect(formatRatio(0.5)).toBe("0.50×")
    expect(formatRatio(1.006)).toBe("1.0×")
    expect(formatRatio(2.64)).toBe("2.6×")
  })

  it("rounds to a whole number from 10 and groups the thousands", () => {
    expect(formatRatio(9.96)).toBe("10×")
    expect(formatRatio(10.4)).toBe("10×")
    expect(formatRatio(1234.5)).toBe("1,235×")
  })
})

describe("formatPercent", () => {
  it("writes the edges as bounds and keeps 0 and the whole", () => {
    expect(formatPercent(0, 100)).toBe("0%")
    expect(formatPercent(100, 100)).toBe("100%")
    expect(formatPercent(1, 100000)).toBe("<1%")
    expect(formatPercent(4100499, 4100500)).toBe(">99%")
    expect(formatPercent(0, 0)).toBe("0%")
    expect(formatPercent(50, 100)).toBe("50%")
  })
})
