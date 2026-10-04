import { fc, test } from "@fast-check/vitest"
import { describe, expect } from "vitest"

import { isDay, isoDate, RECENT_YEARS, recentRange, recentYearsOf, yearsBefore } from "~/lib/date-range"

const anyDay = fc.date({ min: new Date(1100, 0, 1), max: new Date(9000, 11, 31), noInvalidDate: true }).map(isoDate)
// A uniform day is February 29 once in 1461 days, so those days are mixed in.
const leapDay = fc
  .integer({ min: 275, max: 2250 })
  .map((n) => `${String(n * 4).padStart(4, "0")}-02-29`)
  .filter(isDay)
const day = fc.oneof(anyDay, leapDay)

const isLeapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

describe("date ranges", () => {
  test.prop([day, fc.integer({ min: 0, max: 99 })])(
    "returns the same month and day in the year that is the given number of years earlier, and February 28 for February 29 in a year without it",
    (today, years) => {
      const year = Number(today.slice(0, 4)) - years
      const monthDay = today.slice(5) === "02-29" && !isLeapYear(year) ? "02-28" : today.slice(5)
      expect(yearsBefore(today, years)).toBe(`${String(year).padStart(4, "0")}-${monthDay}`)
    },
  )

  test.prop([day, fc.constantFrom(...RECENT_YEARS)])("names a recent window as the window it was made from", (today, years) => {
    const range = recentRange(today, years)
    expect(range.from <= range.to).toBe(true)
    expect(recentYearsOf(range, today)).toBe(years)
  })
})
