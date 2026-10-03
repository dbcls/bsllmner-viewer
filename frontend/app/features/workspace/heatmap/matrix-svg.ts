import { RATIO_STEPS, token } from "~/lib/color"
import { escapeXml } from "~/lib/export"
import { cut, FIGURE_MARGIN, FIGURE_SANS, HEADING_HEIGHT, headingSvg, textAttrs, textSize, textWidth } from "~/lib/figure-style"
import { formatCount } from "~/lib/format"

export type MatrixCell = {
  row: string
  col: string
  text: string
  background: string
  dark: boolean
  gap: boolean
  /** The text is in the grey of the page, as on the page: a 0 that is not a gap, or a ratio that is not colored. */
  soft: boolean
}

/**
 * A row or a column: its element, its label, the term ID under the label when the chart shows term IDs, and its total.
 * `depth` is how far a row is nested under the rows above it; the labels of a deeper row start further right.
 */
type MatrixLabel = { value: string; label: string; id?: string; total: number; depth?: number }

/** How far the label of a row moves right for each level of depth, in px, as on the page. */
export const ROW_INDENT = 18

/** The tokens of the colors of the count scale, from 0 to the largest count. */
export const COUNT_SCALE_TOKENS = ["--color-brand-soft", "--color-brand-light", "--color-brand", "--color-brand-deeper"]

/** What the legend explains: the scale of the colors of the cells. The gap is always explained. */
export type MatrixLegend = { kind: "count"; max: string } | { kind: "ratio" }

export type MatrixExport = {
  rowLabels: MatrixLabel[]
  colLabels: MatrixLabel[]
  cells: MatrixCell[]
  /** The names of the row and the column dimensions, written in the top left corner. */
  corner: { row: string; col: string }
  total: number
  /** The name of the figure, and what the cells count, on the heading line. */
  title: string
  meta: string
  legend: MatrixLegend
}

const cellKey = (row: string, col: string): string => `${row}\t${col}`

/** The advance of a character of a term ID: IBM Plex Mono, 0.6em. */
const idWidth = (id: string): number => textWidth(id, textSize("termId"), true)

const CELL_HEIGHT = 32
const ROW_PITCH = CELL_HEIGHT + 2
const LABEL_MARGIN = FIGURE_MARGIN
const MIN_COLUMN_WIDTH = 74
/** The widest that a column grows for its label, as the columns of the page (96px with 4px of padding on each side). */
const MAX_LABEL_COLUMN_WIDTH = 96
const COLUMN_PADDING = 4
/** Space around the term ID under a column label, both sides together, as the columns of the page keep 8px on each side. */
const ID_PADDING = 16
/** The most lines of a column label; a longer label ends with an ellipsis. */
const MAX_LABEL_LINES = 3
const LABEL_LINE_HEIGHT = 13
/** The distance from the bottom of the column headers to the baseline of the last label line, with and without term IDs. */
const LABEL_BASE_WITH_ID = 24
const LABEL_BASE = 12
/** Space above the column labels, for the first line and the corner. */
const COLUMN_HEADER_TOP = 28
/** The widest area that the row labels take at the left of the cells, counting both margins. */
const MAX_ROW_AREA = 400
/** Space between a row label and its term ID. */
const ID_GAP = 4
const CORNER_GAP = 24
const LEGEND_HEIGHT = 34
const SWATCH_WIDTH = 22
const SWATCH_HEIGHT = 14
const COUNT_BAR_WIDTH = 100
const COUNT_BAR_HEIGHT = 10
/** Space between a swatch and the text after it. */
const SWATCH_TEXT_GAP = 6

const labelWidth = (text: string, role: "heatRowLabel" | "heatColumnLabel"): number => textWidth(text, textSize(role))

/** The characters of `word` in pieces that each fit in `room` px. */
const pieces = (word: string, room: number): string[] => {
  const per = Math.max(1, Math.floor(room / textWidth("n", textSize("heatColumnLabel"))))
  const characters = Array.from(word)
  return Array.from({ length: Math.ceil(characters.length / per) }, (_, index) => characters.slice(index * per, (index + 1) * per).join(""))
}

/** The label of a column in lines of at most `room` px, at most `MAX_LABEL_LINES`, the last one ending with an ellipsis when the label is longer. */
export const wrapColumnLabel = (label: string, room: number): string[] => {
  const lines: string[] = []
  let line = ""
  for (const piece of label.split(/\s+/).filter(Boolean).flatMap((word) => pieces(word, room))) {
    const joined = line ? `${line} ${piece}` : piece
    if (line && labelWidth(joined, "heatColumnLabel") > room) {
      lines.push(line)
      line = piece
    } else {
      line = joined
    }
  }
  if (line) lines.push(line)
  if (lines.length <= MAX_LABEL_LINES) return lines.length ? lines : [""]
  const fit = Math.max(1, Math.floor(room / textWidth("n", textSize("heatColumnLabel"))))
  return [...lines.slice(0, MAX_LABEL_LINES - 1), cut(lines.slice(MAX_LABEL_LINES - 1).join(" "), fit)]
}

/**
 * The width of a column of cells: 74, or wider so that the longest term ID under the column labels keeps 8 on each side
 * and the longest label fits on one line, up to 96 as the columns of the page; a longer label wraps.
 */
const columnWidth = (cols: MatrixLabel[]): number =>
  Math.max(
    MIN_COLUMN_WIDTH,
    ...cols.map((col) => (col.id ? Math.ceil(idWidth(col.id)) + ID_PADDING : 0)),
    Math.min(MAX_LABEL_COLUMN_WIDTH, Math.max(0, ...cols.map((col) => Math.ceil(labelWidth(col.label, "heatColumnLabel")) + 2 * COLUMN_PADDING))),
  )

const columnLines = (cols: MatrixLabel[], width: number): string[][] => cols.map((col) => wrapColumnLabel(col.label, width - 2 * COLUMN_PADDING))

const columnHeaderHeight = (cols: MatrixLabel[], width: number): number =>
  COLUMN_HEADER_TOP + (cols.some((col) => col.id) ? LABEL_BASE_WITH_ID : LABEL_BASE) + (Math.max(1, ...columnLines(cols, width).map((lines) => lines.length)) - 1) * LABEL_LINE_HEIGHT

const maxDepth = (rows: MatrixLabel[]): number => Math.max(0, ...rows.map((row) => row.depth ?? 0))

/** The width of the label of a row with its indent and its term ID, in px. */
const rowWidth = (row: MatrixLabel): number =>
  (row.depth ?? 0) * ROW_INDENT + labelWidth(row.label, "heatRowLabel") + (row.id ? ID_GAP + idWidth(row.id) : 0)

/** The width of the names of the axes in the top left corner. */
const cornerWidth = (corner: { row: string; col: string }): number =>
  textWidth(`${corner.row} ↓`, textSize("heatHeading")) + CORNER_GAP + textWidth(`${corner.col} →`, textSize("heatHeading"))

/**
 * The room for the labels of the rows at the left of the cells: as wide as the longest row label with its indent and
 * term ID, or the names of the axes, up to `MAX_ROW_AREA`.
 */
const leftOf = (rows: MatrixLabel[], corner: { row: string; col: string }): number =>
  Math.min(MAX_ROW_AREA + maxDepth(rows) * ROW_INDENT, Math.ceil(Math.max(0, ...rows.map(rowWidth), cornerWidth(corner))) + 2 * LABEL_MARGIN)

/** The label of a row cut so that it and its term ID fit in `room` px. */
const fitRowLabel = (row: MatrixLabel, room: number): string => {
  const available = room - (row.id ? ID_GAP + idWidth(row.id) : 0)
  return cut(row.label, Math.max(6, Math.floor(available / textWidth("n", textSize("heatRowLabel")))))
}

type LegendItem = {
  width: number
  /** The markup of the item with its left edge at `x` and its middle at `y`. */
  draw: (x: number, y: number) => string
}

const legendText = (x: number, y: number, text: string): string =>
  `<text x="${x}" y="${y + 4}" ${textAttrs("meta")} fill="${token("--color-ink-soft")}">${escapeXml(text)}</text>`

const legendSwatch = (x: number, y: number, fill: string, attributes: string): string =>
  `<rect x="${x}" y="${y - SWATCH_HEIGHT / 2}" width="${SWATCH_WIDTH}" height="${SWATCH_HEIGHT}" rx="2" fill="${fill}" ${attributes}/>`

/** A swatch followed by what it means. */
const swatchItem = (fill: string, text: string, attributes = ""): LegendItem => ({
  width: SWATCH_WIDTH + SWATCH_TEXT_GAP + textWidth(text, textSize("meta")),
  draw: (x, y) => `${legendSwatch(x, y, fill, attributes)}${legendText(x + SWATCH_WIDTH + SWATCH_TEXT_GAP, y, text)}`,
})

/** The items of the legend: the scale of the colors of the cells, as the page shows it, then the gap. */
const legendItems = (legend: MatrixLegend): LegendItem[] => {
  const border = `stroke="${token("--color-border-soft")}"`
  const scale: LegendItem[] =
    legend.kind === "count"
      ? [
        {
          width: textWidth("0", textSize("meta")) + 2 * SWATCH_TEXT_GAP + COUNT_BAR_WIDTH + textWidth(legend.max, textSize("meta")),
          draw: (x, y) => {
            const stops = COUNT_SCALE_TOKENS.map((name, index) => `<stop offset="${index / (COUNT_SCALE_TOKENS.length - 1)}" stop-color="${token(name)}"/>`).join("")
            const barX = x + textWidth("0", textSize("meta")) + SWATCH_TEXT_GAP
            return (
              `<defs><linearGradient id="count-scale">${stops}</linearGradient></defs>${legendText(x, y, "0")}` +
                `<rect x="${barX}" y="${y - COUNT_BAR_HEIGHT / 2}" width="${COUNT_BAR_WIDTH}" height="${COUNT_BAR_HEIGHT}" rx="2" fill="url(#count-scale)"/>` +
                legendText(barX + COUNT_BAR_WIDTH + SWATCH_TEXT_GAP, y, legend.max)
            )
          },
        },
      ]
      : [
        swatchItem(token("--color-surface"), `≤ ${RATIO_STEPS.low}×`, border),
        swatchItem(token("--color-brand-tint"), `< ${RATIO_STEPS.mid}×`),
        swatchItem(token("--color-brand-light"), `≥ ${RATIO_STEPS.mid}×`),
        swatchItem(token("--color-brand"), `≥ ${RATIO_STEPS.high}×`),
      ]
  return [...scale, swatchItem(token("--color-surface"), "Gap", `stroke="${token("--color-critical-fg")}" stroke-dasharray="3 2" stroke-width="1.5"`)]
}

const LEGEND_ITEM_GAP = 16
/** Space between the name of the figure and what the cells count. */
const HEADING_GAP = 24

const legendWidth = (legend: MatrixLegend): number => legendItems(legend).reduce((sum, item, index) => sum + item.width + (index > 0 ? LEGEND_ITEM_GAP : 0), 0)

/** The width that the heading line needs: the name, a space, and what the cells count, with the margins. */
const headingWidth = (title: string, meta: string): number =>
  Math.ceil(textWidth(title, textSize("heading")) + textWidth(meta, textSize("meta"))) + 2 * LABEL_MARGIN + HEADING_GAP

export const matrixSvgSize = (data: Pick<MatrixExport, "rowLabels" | "colLabels" | "legend" | "title" | "meta" | "corner">): { width: number; height: number } => ({
  width: Math.max(
    leftOf(data.rowLabels, data.corner) + data.colLabels.length * (columnWidth(data.colLabels) + 2) + 80,
    Math.ceil(legendWidth(data.legend)) + 2 * LABEL_MARGIN,
    headingWidth(data.title, data.meta),
  ),
  height: HEADING_HEIGHT + columnHeaderHeight(data.colLabels, columnWidth(data.colLabels)) + data.rowLabels.length * ROW_PITCH + 30 + LEGEND_HEIGHT,
})

/** An SVG rendering of the cross-tabulation, for download. */
export const matrixSvg = (data: MatrixExport): string => {
  const cellW = columnWidth(data.colLabels)
  const left = leftOf(data.rowLabels, data.corner)
  const top = HEADING_HEIGHT + columnHeaderHeight(data.colLabels, cellW)
  const { width, height } = matrixSvgSize(data)
  const totalX = left + data.colLabels.length * (cellW + 2) + 70
  const byKey = new Map(data.cells.map((c) => [cellKey(c.row, c.col), c]))
  const soft = token("--color-ink-soft")
  const ink = token("--color-ink")
  const hasColumnIds = data.colLabels.some((col) => col.id)
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FIGURE_SANS}" font-size="${textSize("meta")}">`,
    `<rect width="${width}" height="${height}" fill="${token("--color-surface")}"/>`,
    headingSvg(width, data.title, data.meta),
    // The corner names the axes on one line as the page does, the rows first and the columns after a wide space, in the
    // grey of the totals so that the names are not read as terms.
    `<text x="${LABEL_MARGIN}" y="${top - 12}" ${textAttrs("heatHeading")} fill="${soft}">${escapeXml(data.corner.row)} ↓<tspan dx="${CORNER_GAP}">${escapeXml(data.corner.col)} →</tspan></text>`,
  ]
  const id = (x: number, y: number, text: string) =>
    `<text x="${x}" y="${y}" text-anchor="middle" ${textAttrs("termId")} fill="${soft}">${escapeXml(text)}</text>`
  const labels = columnLines(data.colLabels, cellW)
  data.colLabels.forEach((col, j) => {
    const x = left + j * (cellW + 2) + cellW / 2
    const lines = labels[j] ?? [""]
    const first = top - (hasColumnIds ? LABEL_BASE_WITH_ID : LABEL_BASE) - (lines.length - 1) * LABEL_LINE_HEIGHT
    const tspans = lines.map((line, k) => `<tspan x="${x}" dy="${k === 0 ? 0 : LABEL_LINE_HEIGHT}">${escapeXml(line)}</tspan>`).join("")
    parts.push(`<text x="${x}" y="${first}" text-anchor="middle" ${textAttrs("heatColumnLabel")} fill="${ink}">${tspans}</text>`)
    if (col.id) parts.push(id(x, top - 11, col.id))
  })
  parts.push(`<text x="${totalX}" y="${top - 12}" text-anchor="end" ${textAttrs("heatHeading")} fill="${soft}">Row total</text>`)
  data.rowLabels.forEach((row, i) => {
    const y = top + i * ROW_PITCH
    const x0 = LABEL_MARGIN + (row.depth ?? 0) * ROW_INDENT
    const idSpan = row.id ? `<tspan dx="${ID_GAP}" ${textAttrs("termId", true)} fill="${soft}">${escapeXml(row.id)}</tspan>` : ""
    parts.push(`<text x="${x0}" y="${y + CELL_HEIGHT / 2 + 4}" ${textAttrs("heatRowLabel")} fill="${ink}">${escapeXml(fitRowLabel(row, left - x0 - LABEL_MARGIN))}${idSpan}</text>`)
    data.colLabels.forEach((col, j) => {
      const cell = byKey.get(cellKey(row.value, col.value))
      const x = left + j * (cellW + 2)
      const fill = cell?.background ?? token("--color-surface")
      const stroke = cell?.gap ? `stroke="${token("--color-critical-fg")}" stroke-dasharray="3 2" stroke-width="1.5"` : ""
      parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${CELL_HEIGHT}" rx="3" fill="${fill}" ${stroke}/>`)
      const color = cell?.gap
        ? token("--color-critical-fg")
        : cell?.dark
          ? token("--color-surface")
          : cell?.soft
            ? soft
            : ink
      parts.push(
        `<text x="${x + cellW / 2}" y="${y + CELL_HEIGHT / 2 + 4}" text-anchor="middle" ${textAttrs(cell?.gap ? "heatGapCell" : "heatCell")} fill="${color}">${escapeXml(cell?.text ?? "")}</text>`,
      )
    })
    parts.push(
      `<text x="${totalX}" y="${y + CELL_HEIGHT / 2 + 4}" text-anchor="end" ${textAttrs("heatTotal")} fill="${soft}">${formatCount(row.total)}</text>`,
    )
  })
  const totalY = top + data.rowLabels.length * ROW_PITCH + 18
  parts.push(`<text x="${LABEL_MARGIN}" y="${totalY}" ${textAttrs("heatHeading")} fill="${soft}">Column total</text>`)
  data.colLabels.forEach((col, j) => {
    const x = left + j * (cellW + 2) + cellW / 2
    parts.push(`<text x="${x}" y="${totalY}" text-anchor="middle" ${textAttrs("heatTotal")} fill="${soft}">${formatCount(col.total)}</text>`)
  })
  parts.push(
    `<text x="${totalX}" y="${totalY}" text-anchor="end" ${textAttrs("heatGrandTotal")} fill="${token("--color-ink-mid")}">${formatCount(data.total)}</text>`,
  )
  let legendX = LABEL_MARGIN
  for (const item of legendItems(data.legend)) {
    parts.push(item.draw(legendX, totalY + 30))
    legendX += item.width + LEGEND_ITEM_GAP
  }
  parts.push("</svg>")
  return parts.join("")
}
