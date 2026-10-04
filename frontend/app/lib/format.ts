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

const SIZE_UNITS = ["KB", "MB", "GB", "TB"] as const
const sizeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

/**
 * A size in bytes, with two significant digits and a unit of 1,000 from KB to TB: "<1 KB", "1.1 KB", "990 MB", "4.1 GB".
 * The unit is chosen after the rounding, so that 999,999 B reads "1 MB" and not "1000 KB".
 */
export const formatSize = (bytes: number): string => {
  let value = bytes / 1000
  if (!(value >= 1)) return "<1 KB"
  let unit = 0
  let rounded = Number(value.toPrecision(2))
  while (rounded >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000
    unit += 1
    rounded = Number(value.toPrecision(2))
  }
  return `${sizeNumber.format(rounded)} ${SIZE_UNITS[unit]}`
}
