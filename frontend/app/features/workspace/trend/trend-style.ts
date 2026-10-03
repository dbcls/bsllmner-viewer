/** The width, the radius of the points, and the layer of each kind of line of the Trend chart, for the page and the saved figure. */
export const TREND_LINE = {
  /** The line of all entries. */
  all: { width: 2, radius: 3.5, layer: 1 },
  /** The line of the entries that match the condition. */
  condition: { width: 3, radius: 4.5, layer: 2 },
  /** The line of one term of the chosen field. */
  series: { width: 2, radius: 4, layer: 0 },
} as const
