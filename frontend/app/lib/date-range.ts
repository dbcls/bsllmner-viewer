/** Date ranges of the publication-date condition: relative windows that end today, and their labels. */

/** The windows, in years before today, that the publication-date condition offers. */
export const RECENT_YEARS = [1, 5, 10] as const

export type RecentYears = (typeof RECENT_YEARS)[number]

const pad = (value: number, width: number): string => String(value).padStart(width, "0")

/** `YYYY-MM-DD` of a date in the local time zone, so "today" is the day the user sees. */
export const isoDate = (date: Date): string => `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`

const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate()

/** The same day `years` years before `day` (`YYYY-MM-DD`). February 29 becomes February 28 in a year without it. */
export const yearsBefore = (day: string, years: number): string => {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number)
  const target = year - years
  return `${pad(target, 4)}-${pad(month, 2)}-${pad(Math.min(date, daysInMonth(target, month - 1)), 2)}`
}

export type DateRange = {
  from: string
  to: string
}

/** The range of the last `years` years, ending `today`. */
export const recentRange = (today: string, years: number): DateRange => ({ from: yearsBefore(today, years), to: today })

/** The window that a range is, relative to `today`, or null when it is not one of `RECENT_YEARS`. */
export const recentYearsOf = (range: DateRange, today: string): RecentYears | null =>
  RECENT_YEARS.find((years) => range.to === today && range.from === yearsBefore(today, years)) ?? null

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Whether a string is a calendar day `YYYY-MM-DD` from the year 1000 on. */
export const isDay = (value: string): boolean => {
  const match = DAY.exec(value)
  if (!match) return false
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return year >= 1000 && month >= 1 && month <= 12 && date >= 1 && date <= daysInMonth(year, month - 1)
}

/**
 * The range that a start day and an end day ask for. An empty end means `today`. Null when the start is empty or
 * either day is not a calendar day, and "reversed" when the start is after the end.
 */
export const enteredRange = (from: string, to: string, today: string): DateRange | "reversed" | null => {
  const end = to === "" ? today : to
  if (!isDay(from) || !isDay(end)) return null
  return from > end ? "reversed" : { from, to: end }
}

/** A short label of a range: years when it spans whole years, the days otherwise. */
export const rangeLabel = ({ from, to }: DateRange): string => {
  if (from.endsWith("-01-01") && to.endsWith("-12-31")) {
    const first = from.slice(0, 4)
    const last = to.slice(0, 4)
    return first === last ? first : `${first}–${last}`
  }
  return from === to ? from : `${from} – ${to}`
}
