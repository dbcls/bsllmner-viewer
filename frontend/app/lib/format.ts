const integer = new Intl.NumberFormat("en-US")

export const formatCount = (value: number): string => integer.format(Math.round(value))

export const formatPercent = (value: number, total: number): string =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : "0%"

/** A ratio to an expected count, with two significant digits from 0.01 to 10: "0×", "<0.01×", "0.054×", "2.6×", "33×". */
export const formatRatio = (value: number): string => {
  if (value === 0) return "0×"
  if (value < 0.01) return "<0.01×"
  return `${value < 10 ? value.toPrecision(2) : formatCount(value)}×`
}
