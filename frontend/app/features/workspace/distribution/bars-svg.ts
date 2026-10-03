import { token } from "~/lib/color"
import { escapeXml } from "~/lib/export"
import { formatCount } from "~/lib/format"

export type BarDatum = {
  label: string
  /** The term ID, written after the label in the grey of the page, when the chart shows term IDs. */
  id?: string
  count: number
}

const ROW_HEIGHT = 30
const WIDTH = 480
const HEADER_HEIGHT = 40

/** The size of the SVG that `barsSvg` writes for the rows. */
export const barsSvgSize = (rows: readonly unknown[]): { width: number; height: number } => ({
  width: WIDTH,
  height: HEADER_HEIGHT + rows.length * ROW_HEIGHT,
})

/** An SVG rendering of a distribution card, for download. */
export const barsSvg = (title: string, unit: string, rows: BarDatum[]): string => {
  const { width, height } = barsSvgSize(rows)
  const max = Math.max(1, ...rows.map((r) => r.count))
  const barLeft = 12
  const barWidth = 380
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Public Sans, sans-serif" font-size="12">`,
    `<rect width="${width}" height="${height}" fill="${token("--color-surface")}"/>`,
    `<text x="12" y="20" font-weight="600" fill="${token("--color-ink")}">${escapeXml(title)}</text>`,
    `<text x="${width - 12}" y="20" text-anchor="end" fill="${token("--color-ink-soft")}" font-size="11">${escapeXml(unit)}</text>`,
  ]
  rows.forEach((row, index) => {
    const y = HEADER_HEIGHT + index * ROW_HEIGHT
    const x = barLeft
    const total = (row.count / max) * barWidth
    const id = row.id ? `<tspan font-family="IBM Plex Mono, monospace" font-size="10" fill="${token("--color-ink-soft")}"> ${escapeXml(row.id)}</tspan>` : ""
    parts.push(`<text x="${x}" y="${y + 10}" fill="${token("--color-ink")}">${escapeXml(row.label)}${id}</text>`)
    parts.push(`<rect x="${x}" y="${y + 15}" width="${barWidth}" height="8" rx="2" fill="${token("--color-brand-soft")}"/>`)
    parts.push(`<rect x="${x}" y="${y + 15}" width="${total.toFixed(1)}" height="8" rx="2" fill="${token("--color-brand-light")}"/>`)
    parts.push(`<text x="${width - 12}" y="${y + 22}" text-anchor="end" font-family="IBM Plex Mono, monospace" fill="${token("--color-ink-mid")}">${formatCount(row.count)}</text>`)
  })
  parts.push("</svg>")
  return parts.join("")
}
