import { token } from "~/lib/color"
import { formatCount } from "~/lib/format"

export type BarDatum = {
  label: string
  count: number
  exact: number
  selected: number
  depth: number
}

const escape = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

/** An SVG rendering of a distribution card, for download. */
export const barsSvg = (title: string, unit: string, rows: BarDatum[]): string => {
  const rowHeight = 30
  const width = 480
  const height = 40 + rows.length * rowHeight
  const max = Math.max(1, ...rows.map((r) => r.count))
  const barLeft = 12
  const barWidth = 380
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Public Sans, sans-serif" font-size="12">`,
    `<rect width="${width}" height="${height}" fill="${token("--color-surface")}"/>`,
    `<text x="12" y="20" font-weight="600" fill="${token("--color-ink")}">${escape(title)}</text>`,
    `<text x="${width - 12}" y="20" text-anchor="end" fill="${token("--color-ink-soft")}" font-size="11">${escape(unit)}</text>`,
  ]
  rows.forEach((row, index) => {
    const y = 40 + index * rowHeight
    const x = barLeft + row.depth * 14
    const total = (row.count / max) * (barWidth - row.depth * 14)
    const exact = row.count > 0 ? (row.exact / (row.exact + row.selected || 1)) * total : 0
    parts.push(`<text x="${x}" y="${y + 10}" fill="${token("--color-ink")}">${escape(row.label)}</text>`)
    parts.push(`<rect x="${x}" y="${y + 15}" width="${barWidth - row.depth * 14}" height="8" rx="2" fill="${token("--color-brand-soft")}"/>`)
    parts.push(`<rect x="${x}" y="${y + 15}" width="${exact.toFixed(1)}" height="8" fill="${token("--color-brand")}"/>`)
    parts.push(`<rect x="${(x + exact).toFixed(1)}" y="${y + 15}" width="${(total - exact).toFixed(1)}" height="8" fill="${token("--color-brand-light")}"/>`)
    parts.push(`<text x="${width - 12}" y="${y + 22}" text-anchor="end" font-family="IBM Plex Mono, monospace" fill="${token("--color-ink-mid")}">${formatCount(row.count)}</text>`)
  })
  parts.push("</svg>")
  return parts.join("")
}
