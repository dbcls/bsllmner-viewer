import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { isDay, isoDate, RECENT_YEARS, recentRange, recentYearsOf, yearsBefore } from "~/lib/date-range"

const day = fc.date({ min: new Date(1100, 0, 1), max: new Date(9000, 11, 31), noInvalidDate: true }).map(isoDate)

describe("date ranges", () => {
  test.prop([day, fc.integer({ min: 0, max: 99 })])("goes back to a calendar day in the same month, never after the same day", (today, years) => {
    const before = yearsBefore(today, years)
    expect(isDay(before)).toBe(true)
    expect(before.slice(0, 4)).toBe(String(Number(today.slice(0, 4)) - years).padStart(4, "0"))
    expect(before.slice(5, 7)).toBe(today.slice(5, 7))
    expect(before.slice(8) <= today.slice(8)).toBe(true)
  })

  test.prop([day, fc.constantFrom(...RECENT_YEARS)])("names a recent window as the window it was made from", (today, years) => {
    const range = recentRange(today, years)
    expect(range.from <= range.to).toBe(true)
    expect(recentYearsOf(range, today)).toBe(years)
  })
})
