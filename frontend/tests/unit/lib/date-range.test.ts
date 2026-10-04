import { describe, expect, it } from "vitest"

import { enteredRange, isDay, isoDate, rangeLabel, recentRange, recentYearsOf, yearsBefore } from "~/lib/date-range"

describe("isoDate", () => {
  it("writes the local calendar day with zero padding", () => {
    expect(isoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
    expect(isoDate(new Date(2026, 9, 2, 0, 0))).toBe("2026-10-02")
  })
})

describe("yearsBefore", () => {
  it("keeps the month and the day", () => {
    expect(yearsBefore("2026-10-02", 5)).toBe("2021-10-02")
    expect(yearsBefore("2026-01-01", 1)).toBe("2025-01-01")
  })

  it("moves February 29 to February 28 in a year without it, and keeps it in a leap year", () => {
    expect(yearsBefore("2024-02-29", 1)).toBe("2023-02-28")
    expect(yearsBefore("2024-02-29", 4)).toBe("2020-02-29")
    expect(yearsBefore("2000-02-29", 100)).toBe("1900-02-28")
  })
})

describe("recentYearsOf", () => {
  it("names the window of a range that ends today", () => {
    expect(recentYearsOf(recentRange("2026-10-02", 5), "2026-10-02")).toBe(5)
    expect(recentYearsOf({ from: "2025-10-02", to: "2026-10-02" }, "2026-10-02")).toBe(1)
  })

  it("names no window when the range does not end today or has another length", () => {
    expect(recentYearsOf(recentRange("2026-10-01", 5), "2026-10-02")).toBeNull()
    expect(recentYearsOf({ from: "2023-10-02", to: "2026-10-02" }, "2026-10-02")).toBeNull()
    expect(recentYearsOf({ from: "2015-01-01", to: "2020-12-31" }, "2026-10-02")).toBeNull()
  })
})

describe("isDay", () => {
  it("accepts calendar days and rejects the rest", () => {
    expect(isDay("2024-02-29")).toBe(true)
    expect(isDay("2023-02-29")).toBe(false)
    expect(isDay("2023-13-01")).toBe(false)
    expect(isDay("2023-04-31")).toBe(false)
    expect(isDay("0999-01-01")).toBe(false)
    expect(isDay("2023-1-01")).toBe(false)
    expect(isDay("")).toBe(false)
  })
})

describe("enteredRange", () => {
  it("returns the range of two days, and ends it today when the end is empty", () => {
    expect(enteredRange("2015-01-01", "2020-12-31", "2026-10-02")).toEqual({ from: "2015-01-01", to: "2020-12-31" })
    expect(enteredRange("2015-01-01", "", "2026-10-02")).toEqual({ from: "2015-01-01", to: "2026-10-02" })
    expect(enteredRange("2020-05-05", "2020-05-05", "2026-10-02")).toEqual({ from: "2020-05-05", to: "2020-05-05" })
  })

  it("returns null without a start or with a day that is not a calendar day", () => {
    expect(enteredRange("", "2020-12-31", "2026-10-02")).toBeNull()
    expect(enteredRange("0002-01-01", "", "2026-10-02")).toBeNull()
    expect(enteredRange("2015-01-01", "2020-02-30", "2026-10-02")).toBeNull()
  })

  it("reports a start after the end", () => {
    expect(enteredRange("2021-01-01", "2020-12-31", "2026-10-02")).toBe("reversed")
    expect(enteredRange("2027-01-01", "", "2026-10-02")).toBe("reversed")
  })
})

describe("rangeLabel", () => {
  it("shows whole years as years and other ranges as days", () => {
    expect(rangeLabel({ from: "2015-01-01", to: "2020-12-31" })).toBe("2015–2020")
    expect(rangeLabel({ from: "2020-01-01", to: "2020-12-31" })).toBe("2020")
    expect(rangeLabel({ from: "2021-10-02", to: "2026-10-02" })).toBe("2021-10-02 – 2026-10-02")
    expect(rangeLabel({ from: "2021-10-02", to: "2021-10-02" })).toBe("2021-10-02")
    expect(rangeLabel({ from: "2020-01-01", to: "2020-06-30" })).toBe("2020-01-01 – 2020-06-30")
    expect(rangeLabel({ from: "2020-03-01", to: "2020-12-31" })).toBe("2020-03-01 – 2020-12-31")
  })
})
