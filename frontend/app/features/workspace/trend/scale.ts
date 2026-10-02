/** Pure pixel layout for the Trend chart's inline SVG (viewBox 0 0 960 320). */

export type Plot = { left: number; right: number; top: number; bottom: number }

/** The plot rectangle: the api's years span left..right, counts span bottom (0) .. top (max). */
export const PLOT: Plot = { left: 70, right: 940, top: 16, bottom: 280 }

const STEP_FACTORS: readonly number[] = [1, 2, 2.5, 5]
const MAX_INTERVALS = 5

/**
 * The distance between grid lines for counts up to `max`: the smallest of 1, 2, 2.5, 5 × 10^n that is a whole
 * number and spans `max` in at most five intervals.
 */
export const gridStep = (max: number): number => {
  for (let base = 1; ; base *= 10) {
    for (const factor of STEP_FACTORS) {
      const step = base * factor
      if (Number.isInteger(step) && max / step <= MAX_INTERVALS) return step
    }
  }
}

/** The y-axis maximum: the largest count rounded up to a grid line, at least 1 so that an all-zero chart still has a scale. */
export const yMax = (counts: number[]): number => {
  const largest = Math.max(1, ...counts)
  const step = gridStep(largest)
  return Math.ceil(largest / step) * step
}

/** Evenly spaced x position for the year at `index` of `count` years; a single year sits at the plot's center. */
export const xForIndex = (index: number, count: number, plot: Plot = PLOT): number =>
  count <= 1 ? (plot.left + plot.right) / 2 : plot.left + (index / (count - 1)) * (plot.right - plot.left)

/** Linear y position of `value` on a 0..max scale: `max` maps to the plot top, 0 to the plot bottom. */
export const yForValue = (value: number, max: number, plot: Plot = PLOT): number =>
  plot.bottom - (max <= 0 ? 0 : value / max) * (plot.bottom - plot.top)

export type GridLine = { value: number; y: number }

/** Grid lines from 0 to the y-axis maximum, one per grid step. */
export const gridLines = (max: number, plot: Plot = PLOT): GridLine[] => {
  const step = gridStep(max)
  const lines: GridLine[] = []
  for (let value = 0; value <= max; value += step) lines.push({ value, y: yForValue(value, max, plot) })
  return lines
}

/** Whether the year label at `index` (of `count` years) is drawn; past 20 years every other one is skipped. */
export const showYearLabel = (index: number, count: number): boolean => count <= 20 || index % 2 === 0
