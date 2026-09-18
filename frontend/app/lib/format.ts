const integer = new Intl.NumberFormat("en-US")

export const formatCount = (value: number): string => integer.format(Math.round(value))

export const formatPercent = (value: number, total: number): string =>
  total > 0 ? `${Math.round((value / total) * 100)}%` : "0%"

export const formatResidual = (value: number | null): string => {
  if (value === null) return "n/a"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(1)}`
}

export const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value
