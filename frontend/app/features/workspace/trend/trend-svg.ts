import { token } from "~/lib/color"
import { escapeXml } from "~/lib/export"
import { FIGURE_MARGIN, FIGURE_SANS, HEADING_HEIGHT, headingSvg, textAttrs, textSize, textWidth } from "~/lib/figure-style"
import { formatCount } from "~/lib/format"

import { gridLines, PLOT, showYearLabel, xForIndex, yForValue } from "./scale"

/** One line of the figure: its name, its color, and its points, one per year in the order of the years. */
export type TrendLine = {
  key: string
  label: string
  /** The term ID, written after the label in the legend when the figure shows term IDs. */
  id?: string
  /** The label is in the bold weight, as the label of the line of the condition is on the page. */
  strong?: boolean
  color: string
  width: number
  /** The line is drawn over the lines of a lower layer, and its labels are written over theirs. */
  layer: number
  /** The radius of the circle at each point. */
  radius: number
  points: { year: number; count: number }[]
}

export type TrendFigure = {
  title: string
  unit: string
  years: number[]
  /** The top of the count axis. */
  max: number
  /** The lines in the order of the legend. */
  lines: TrendLine[]
  /** Write the count above each point that has a match. */
  labels: boolean
}

const WIDTH = 960
const PLOT_HEIGHT = 320
const MARGIN = FIGURE_MARGIN
const LEGEND_ROW = 20
const LEGEND_SWATCH = 16
const LEGEND_GAP = 14
/** Space between a point and the data label above it. */
const DATA_LABEL_GAP = 5

type Placed = { x: number; y: number; r: number; year: number; count: number }

const labelRole = (line: TrendLine) => (line.strong ? "trendLegendCondition" : "trendLegendLabel")

/** The legend items of the lines, wrapped into rows of at most the width of the figure. */
const legendLayout = (lines: TrendLine[]): { line: TrendLine; x: number; row: number }[] => {
  let x = MARGIN
  let row = 0
  return lines.map((line) => {
    const itemWidth = LEGEND_SWATCH + 6 + textWidth(line.label, textSize(labelRole(line))) + (line.id ? 6 + textWidth(line.id, textSize("termId"), true) : 0)
    if (x > MARGIN && x + itemWidth > WIDTH - MARGIN) {
      x = MARGIN
      row += 1
    }
    const placed = { line, x, row }
    x += itemWidth + LEGEND_GAP
    return placed
  })
}

const legendRows = (lines: TrendLine[]): number => Math.max(0, ...legendLayout(lines).map((item) => item.row + 1))

const headerHeight = (lines: TrendLine[]): number => HEADING_HEIGHT + legendRows(lines) * LEGEND_ROW

/** The size of the SVG that `trendSvg` writes: the plot, under the heading line and the legend. */
export const trendSvgSize = (figure: Pick<TrendFigure, "lines">): { width: number; height: number } => ({
  width: WIDTH,
  height: headerHeight(figure.lines) + PLOT_HEIGHT,
})

const place = (figure: TrendFigure, line: TrendLine): Placed[] =>
  line.points.map((point, index) => ({
    x: xForIndex(index, figure.years.length),
    y: yForValue(point.count, figure.max),
    r: line.radius,
    year: point.year,
    count: point.count,
  }))

/** An SVG rendering of the trend chart, for download: the figure as the page draws it, without what is for pressing. */
export const trendSvg = (figure: TrendFigure): string => {
  const { width, height } = trendSvgSize(figure)
  const top = headerHeight(figure.lines)
  const ink = token("--color-ink")
  const soft = token("--color-ink-soft")
  const surface = token("--color-surface")
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FIGURE_SANS}" font-size="${textSize("meta")}">`,
    `<rect width="${width}" height="${height}" fill="${surface}"/>`,
    headingSvg(width, figure.title, figure.unit),
  ]
  for (const { line, x, row } of legendLayout(figure.lines)) {
    const y = HEADING_HEIGHT + row * LEGEND_ROW + 8
    const labelX = x + LEGEND_SWATCH + 6
    parts.push(`<line x1="${x}" x2="${x + LEGEND_SWATCH}" y1="${y}" y2="${y}" stroke="${line.color}" stroke-width="${line.width + 1}"/>`)
    const id = line.id
      ? `<tspan dx="6" ${textAttrs("termId", true)} fill="${soft}">${escapeXml(line.id)}</tspan>`
      : ""
    parts.push(`<text x="${labelX}" y="${y + 4}" ${textAttrs(labelRole(line))} fill="${ink}">${escapeXml(line.label)}${id}</text>`)
  }
  parts.push(`<g transform="translate(0 ${top})">`)
  for (const grid of gridLines(figure.max)) {
    parts.push(`<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${grid.y}" y2="${grid.y}" stroke="${token("--color-grid")}"/>`)
    parts.push(
      `<text x="${PLOT.left - 8}" y="${grid.y + 4}" text-anchor="end" ${textAttrs("trendTick")} fill="${soft}">${formatCount(grid.value)}</text>`,
    )
  }
  parts.push(`<line x1="${PLOT.left}" x2="${PLOT.right}" y1="${PLOT.bottom}" y2="${PLOT.bottom}" stroke="${token("--color-border-soft")}"/>`)
  figure.years.forEach((year, index) => {
    if (!showYearLabel(index, figure.years.length)) return
    parts.push(
      `<text x="${xForIndex(index, figure.years.length)}" y="300" text-anchor="middle" ${textAttrs("trendTick")} fill="${soft}">${year}</text>`,
    )
  })
  const drawn = [...figure.lines].sort((a, b) => a.layer - b.layer).map((line) => ({ line, points: place(figure, line) }))
  for (const { line, points } of drawn) {
    parts.push(`<polyline points="${points.map(({ x, y }) => `${x},${y}`).join(" ")}" fill="none" stroke="${line.color}" stroke-width="${line.width}"/>`)
    for (const { x, y, r } of points) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${surface}" stroke="${line.color}" stroke-width="${line.width}"/>`)
    }
  }
  if (figure.labels) {
    const last = figure.years[figure.years.length - 1]
    for (const { points } of drawn) {
      for (const { x, y, r, year, count } of points) {
        if (count <= 0) continue
        const atEnd = year === last && figure.years.length > 1
        parts.push(
          `<text x="${atEnd ? x + r : x}" y="${y - r - DATA_LABEL_GAP}" text-anchor="${atEnd ? "end" : "middle"}" ${textAttrs("trendTick")} fill="${token("--color-ink-mid")}" stroke="${surface}" stroke-width="3" paint-order="stroke">${formatCount(count)}</text>`,
        )
      }
    }
  }
  parts.push("</g>", "</svg>")
  return parts.join("")
}
