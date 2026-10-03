import { token } from "~/lib/color"
import { escapeXml } from "~/lib/export"
import { cut, FIGURE_MARGIN, FIGURE_SANS, HEADING_HEIGHT, headingSvg, textAttrs, textSize, textWidth } from "~/lib/figure-style"
import { formatCount, formatPercent } from "~/lib/format"

import { WITHOUT_TERM_LABEL } from "./table"

export type BarDatum = {
  label: string
  /** The term ID, written after the label in the grey of the page, when the chart shows term IDs. */
  id?: string
  count: number
}

const ROW_HEIGHT = 30
const WIDTH = 480
const MARGIN = FIGURE_MARGIN

/** The part of the population without a term of the field: how many, and out of how many. */
export type WithoutTerm = { count: number; total: number }

/** The row of the part without a term, under the bars: a rule, the label, and the count with its percentage. */
const WITHOUT_TERM_HEIGHT = 36

/** The size of the SVG that `barsSvg` writes for the rows. */
export const barsSvgSize = (rows: readonly unknown[], withoutTerm: WithoutTerm | null = null): { width: number; height: number } => ({
  width: WIDTH,
  height: HEADING_HEIGHT + 8 + rows.length * ROW_HEIGHT + (withoutTerm ? WITHOUT_TERM_HEIGHT : 0),
})

/** The label cut so that it and the term ID after it fit in the width of the figure. */
const fitLabel = (label: string, id: string | undefined): string => {
  const room = WIDTH - 2 * MARGIN - (id ? textWidth(` ${id}`, textSize("termId"), true) : 0)
  return cut(label, Math.max(8, Math.floor(room / textWidth("n", textSize("barLabel")))))
}

/** An SVG rendering of a distribution card, for download. */
export const barsSvg = (title: string, unit: string, rows: BarDatum[], withoutTerm: WithoutTerm | null = null): string => {
  const { width, height } = barsSvgSize(rows, withoutTerm)
  const max = Math.max(1, ...rows.map((r) => r.count))
  const barLeft = MARGIN
  const barWidth = 380
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FIGURE_SANS}" font-size="${textSize("meta")}">`,
    `<rect width="${width}" height="${height}" fill="${token("--color-surface")}"/>`,
    headingSvg(width, title, unit),
  ]
  rows.forEach((row, index) => {
    const y = HEADING_HEIGHT + 8 + index * ROW_HEIGHT
    const x = barLeft
    const total = (row.count / max) * barWidth
    const id = row.id ? `<tspan ${textAttrs("termId", true)} fill="${token("--color-ink-soft")}"> ${escapeXml(row.id)}</tspan>` : ""
    parts.push(`<text x="${x}" y="${y + 10}" ${textAttrs("barLabel")} fill="${token("--color-ink")}">${escapeXml(fitLabel(row.label, row.id))}${id}</text>`)
    parts.push(`<rect x="${x}" y="${y + 15}" width="${barWidth}" height="8" rx="2" fill="${token("--color-brand-soft")}"/>`)
    parts.push(`<rect x="${x}" y="${y + 15}" width="${total.toFixed(1)}" height="8" rx="2" fill="${token("--color-brand-light")}"/>`)
    parts.push(`<text x="${width - MARGIN}" y="${y + 22}" text-anchor="end" ${textAttrs("barCount")} fill="${token("--color-ink-mid")}">${formatCount(row.count)}</text>`)
  })
  if (withoutTerm) {
    const y = HEADING_HEIGHT + 8 + rows.length * ROW_HEIGHT
    const soft = token("--color-ink-soft")
    parts.push(`<line x1="${MARGIN}" x2="${width - MARGIN}" y1="${y + 4}" y2="${y + 4}" stroke="${token("--color-border-soft")}"/>`)
    parts.push(`<text x="${MARGIN}" y="${y + 26}" ${textAttrs("withoutTermLabel")} fill="${soft}">${WITHOUT_TERM_LABEL}</text>`)
    parts.push(
      `<text x="${width - MARGIN}" y="${y + 26}" text-anchor="end" ${textAttrs("withoutTermCount")} fill="${soft}">${formatCount(withoutTerm.count)} (${formatPercent(withoutTerm.count, withoutTerm.total)})</text>`,
    )
  }
  parts.push("</svg>")
  return parts.join("")
}
