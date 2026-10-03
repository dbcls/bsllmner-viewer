const integer = new Intl.NumberFormat("en-US")

export const formatCount = (value: number): string => integer.format(Math.round(value))

/** A share as a whole percent. A share above 0 never reads "0%" and a share below the whole never reads "100%". */
export const formatPercent = (value: number, total: number): string => {
  if (!(total > 0)) return "0%"
  const percent = (value / total) * 100
  if (percent > 0 && percent < 0.5) return "<1%"
  if (percent >= 99.5 && percent < 100) return ">99%"
  return `${Math.round(percent)}%`
}

/** A ratio to an expected count, with two significant digits from 0.01 to 10: "0×", "<0.01×", "0.054×", "2.6×", "33×". */
export const formatRatio = (value: number): string => {
  if (value === 0) return "0×"
  if (value < 0.01) return "<0.01×"
  return `${value < 10 ? value.toPrecision(2) : formatCount(value)}×`
}
