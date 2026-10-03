import { token } from "~/lib/color"
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

/** A row or a column: its element, its label, the term ID under the label when the chart shows term IDs, and its total. */
export type MatrixLabel = { value: string; label: string; id?: string; total: number }

export type MatrixExport = {
  rowLabels: MatrixLabel[]
  colLabels: MatrixLabel[]
  cells: MatrixCell[]
  /** The names of the row and the column dimensions, written in the top left corner. */
  corner: { row: string; col: string }
  total: number
}

const escape = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const cellKey = (row: string, col: string): string => `${row}\t${col}`

/** The advance of a character of a term ID under a column label: IBM Plex Mono at 9.5px, 0.6em. */
const ID_CHAR_WIDTH = 5.7

/**
 * The width of a column of cells: 74, or wider so that the longest term ID under the column labels keeps 8 on each side,
 * as the columns of the page widen for their IDs.
 */
const columnWidth = (cols: MatrixLabel[]): number => Math.max(74, ...cols.map((col) => (col.id ? Math.ceil(col.id.length * ID_CHAR_WIDTH) + 16 : 0)))

export const matrixSvgSize = (data: Pick<MatrixExport, "rowLabels" | "colLabels">): { width: number; height: number } => ({
  width: 180 + data.colLabels.length * (columnWidth(data.colLabels) + 2) + 80,
  height: 60 + data.rowLabels.length * 34 + 30,
})

/** An SVG rendering of the cross-tabulation, for download. */
export const matrixSvg = (data: MatrixExport): string => {
  const cellW = columnWidth(data.colLabels)
  const cellH = 32
  const left = 180
  const top = 60
  const { width, height } = matrixSvgSize(data)
  const totalX = left + data.colLabels.length * (cellW + 2) + 70
  const byKey = new Map(data.cells.map((c) => [cellKey(c.row, c.col), c]))
  const mono = "IBM Plex Mono, monospace"
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Public Sans, sans-serif" font-size="11">`,
    `<rect width="${width}" height="${height}" fill="${token("--color-surface")}"/>`,
    // The corner names the axes on one line as the page does, the rows first and the columns after a wide space, in the
    // grey of the totals so that the names are not read as terms.
    `<text x="10" y="${top - 12}" font-weight="600" fill="${token("--color-ink-soft")}">${escape(data.corner.row)} ↓<tspan dx="24">${escape(data.corner.col)} →</tspan></text>`,
  ]
  const id = (x: number, y: number, text: string, anchor: string) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${mono}" font-size="9.5" fill="${token("--color-ink-soft")}">${escape(text)}</text>`
  data.colLabels.forEach((col, j) => {
    const x = left + j * (cellW + 2) + cellW / 2
    parts.push(
      `<text x="${x}" y="${col.id ? top - 24 : top - 12}" text-anchor="middle" fill="${token("--color-ink")}">${escape(col.label.slice(0, 14))}</text>`,
    )
    if (col.id) parts.push(id(x, top - 11, col.id, "middle"))
  })
  parts.push(`<text x="${totalX}" y="${top - 12}" text-anchor="end" fill="${token("--color-ink-soft")}" font-weight="600">Row total</text>`)
  data.rowLabels.forEach((row, i) => {
    const y = top + i * (cellH + 2)
    parts.push(`<text x="10" y="${row.id ? y + 13 : y + cellH / 2 + 4}" fill="${token("--color-ink")}">${escape(row.label.slice(0, 26))}</text>`)
    if (row.id) parts.push(id(10, y + 26, row.id, "start"))
    data.colLabels.forEach((col, j) => {
      const cell = byKey.get(cellKey(row.value, col.value))
      const x = left + j * (cellW + 2)
      const fill = cell?.background ?? token("--color-surface")
      const stroke = cell?.gap ? `stroke="${token("--color-critical-fg")}" stroke-dasharray="3 2" stroke-width="1.5"` : ""
      parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="3" fill="${fill}" ${stroke}/>`)
      const color = cell?.gap
        ? token("--color-critical-fg")
        : cell?.dark
          ? token("--color-surface")
          : cell?.soft
            ? token("--color-ink-soft")
            : token("--color-ink")
      parts.push(
        `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" font-family="${mono}" fill="${color}">${escape(cell?.text ?? "")}</text>`,
      )
    })
    parts.push(
      `<text x="${totalX}" y="${y + cellH / 2 + 4}" text-anchor="end" font-family="${mono}" fill="${token("--color-ink-soft")}">${formatCount(row.total)}</text>`,
    )
  })
  const totalY = top + data.rowLabels.length * (cellH + 2) + 18
  parts.push(`<text x="10" y="${totalY}" font-weight="600" fill="${token("--color-ink-soft")}">Column total</text>`)
  data.colLabels.forEach((col, j) => {
    const x = left + j * (cellW + 2) + cellW / 2
    parts.push(`<text x="${x}" y="${totalY}" text-anchor="middle" font-family="${mono}" fill="${token("--color-ink-soft")}">${formatCount(col.total)}</text>`)
  })
  parts.push(
    `<text x="${totalX}" y="${totalY}" text-anchor="end" font-family="${mono}" font-weight="600" fill="${token("--color-ink-mid")}">${formatCount(data.total)}</text>`,
  )
  parts.push("</svg>")
  return parts.join("")
}
