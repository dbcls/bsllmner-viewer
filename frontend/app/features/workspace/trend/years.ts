/**
 * The years from `start` to `end` that are in the data's range or chosen, or none when `start` is after `end`. A chosen
 * year far outside the range adds itself, not the years between.
 */
const yearsBetween = (start: number, end: number, first: number, last: number, chosen: number[]): number[] => {
  const years = new Set<number>(chosen)
  for (let year = Math.max(start, first); year <= Math.min(end, last); year++) years.add(year)
  return [...years].filter((year) => start <= year && year <= end).sort((a, b) => a - b)
}

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
  const chosen = [start, end]
  return {
    from: yearsBetween(low, Math.max(start, end), first, last, chosen),
    to: yearsBetween(Math.min(start, end), high, first, last, chosen),
  }
}
