/** Every year from `start` to `end`, or none when `start` is after `end`. */
const yearsBetween = (start: number, end: number): number[] => (start > end ? [] : Array.from({ length: end - start + 1 }, (_, index) => start + index))

export type YearChoices = { from: number[]; to: number[] }

/**
 * The years that the two selects of the trend's years offer: every year from the first to the last year with a match,
 * and the chosen years even outside them. The first select stops at the chosen last year and the second starts at the
 * chosen first year, so that the selects make no reversed range; each still offers its own chosen year.
 */
export const yearChoices = (first: number, last: number, from: number | null, to: number | null): YearChoices => {
  const start = from ?? first
  const end = to ?? last
  const low = Math.min(first, start, end)
  const high = Math.max(last, start, end)
  return { from: yearsBetween(low, Math.max(start, end)), to: yearsBetween(Math.min(start, end), high) }
}
