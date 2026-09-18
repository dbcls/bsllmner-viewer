/** Pure pixel layout for the Trend chart's inline SVG (viewBox 0 0 960 320). */

export type Plot = { left: number; right: number; top: number; bottom: number }

/** The plot rectangle: the api's years span left..right, counts span bottom (0) .. top (max). */
export const PLOT: Plot = { left: 70, right: 940, top: 16, bottom: 280 }

/** The y-axis maximum: the largest count across all series, floored at 1 so an all-zero series still has a scale. */
export const yMax = (counts: number[]): number => Math.max(1, ...counts)

/** Evenly spaced x position for the year at `index` of `count` years; a single year sits at the plot's center. */
export const xForIndex = (index: number, count: number, plot: Plot = PLOT): number =>
  count <= 1 ? (plot.left + plot.right) / 2 : plot.left + (index / (count - 1)) * (plot.right - plot.left)

/** Linear y position of `value` on a 0..max scale: `max` maps to the plot top, 0 to the plot bottom. */
export const yForValue = (value: number, max: number, plot: Plot = PLOT): number =>
  plot.bottom - (max <= 0 ? 0 : value / max) * (plot.bottom - plot.top)

export type GridLine = { value: number; y: number }

const GRID_FRACTIONS: readonly number[] = [0, 0.25, 0.5, 0.75, 1]

/** Grid line values and y positions at 0/25/50/75/100% of the y-axis maximum. */
export const gridLines = (max: number, plot: Plot = PLOT): GridLine[] =>
  GRID_FRACTIONS.map((fraction) => {
    const value = fraction * max
    return { value, y: yForValue(value, max, plot) }
  })

/** Whether the year label at `index` (of `count` years) is drawn; past 20 years every other one is skipped. */
export const showYearLabel = (index: number, count: number): boolean => count <= 20 || index % 2 === 0
