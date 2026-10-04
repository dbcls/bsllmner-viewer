import { describe, expect, it } from "vitest"

import { formatSize } from "~/lib/format"

describe("formatSize", () => {
  it.each([
    [0, "<1 KB"],
    [999, "<1 KB"],
  ])("puts a size under 1 KB as <1 KB, as an export of no row still has its header (%d B)", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })

  it.each([
    [1000, "1 KB"],
    [1049, "1 KB"],
    [1060, "1.1 KB"],
    [9940, "9.9 KB"],
    [9960, "10 KB"],
    [12_345, "12 KB"],
    [123_456, "120 KB"],
    [1_230_150_000, "1.2 GB"],
    [4_100_500_000, "4.1 GB"],
    [2_060_000_000_000, "2.1 TB"],
  ])("gives two significant digits with the unit (%d B)", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })

  it.each([
    [999_499, "1 MB"],
    [999_999_999, "1 GB"],
    [1_000_000_000, "1 GB"],
    [999_400_000, "1 GB"],
    [994_000_000, "990 MB"],
  ])("goes to the next unit when the rounded value reaches 1,000 (%d B)", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })

  it.each([
    [12_000_000_000_000, "12 TB"],
    [5_000_000_000_000_000, "5,000 TB"],
  ])("has no unit past TB (%d B)", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })
})
