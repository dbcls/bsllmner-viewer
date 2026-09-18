import { token } from "~/lib/color"
import { formatCount } from "~/lib/format"

export type MatrixCell = {
  row: string
  col: string
  text: string
  background: string
  dark: boolean
  gap: boolean
}

export type MatrixExport = {
  rowLabels: { value: string; label: string; total: number }[]
  colLabels: { value: string; label: string; total: number }[]
  cells: MatrixCell[]
  corner: string
  total: number
}

const escape = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const cellKey = (row: string, col: string): string => `${row}\t${col}`

export const matrixSvgSize = (rows: number, cols: number): { width: number; height: number } => ({
  width: 180 + cols * 76 + 80,
  height: 60 + rows * 34 + 30,
})

/** An SVG rendering of the cross-tabulation, for download. */
export const matrixSvg = (data: MatrixExport): string => {
  const cellW = 74
  const cellH = 32
  const left = 180
  const top = 60
  const { width, height } = matrixSvgSize(data.rowLabels.length, data.colLabels.length)
  const totalX = left + data.colLabels.length * (cellW + 2) + 70
  const byKey = new Map(data.cells.map((c) => [cellKey(c.row, c.col), c]))
  const mono = "IBM Plex Mono, monospace"
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Public Sans, sans-serif" font-size="11">`,
    `<rect width="${width}" height="${height}" fill="${token("--color-surface")}"/>`,
    `<text x="10" y="${top - 12}" font-weight="600" fill="${token("--color-ink-soft")}">${escape(data.corner)}</text>`,
  ]
  data.colLabels.forEach((col, j) => {
    const x = left + j * (cellW + 2) + cellW / 2
    parts.push(`<text x="${x}" y="${top - 12}" text-anchor="middle" fill="${token("--color-ink")}">${escape(col.label.slice(0, 14))}</text>`)
  })
  parts.push(`<text x="${totalX}" y="${top - 12}" text-anchor="end" fill="${token("--color-ink-soft")}" font-weight="600">Row total</text>`)
  data.rowLabels.forEach((row, i) => {
    const y = top + i * (cellH + 2)
    parts.push(`<text x="10" y="${y + cellH / 2 + 4}" fill="${token("--color-ink")}">${escape(row.label.slice(0, 26))}</text>`)
    data.colLabels.forEach((col, j) => {
      const cell = byKey.get(cellKey(row.value, col.value))
      const x = left + j * (cellW + 2)
      const fill = cell?.background ?? token("--color-surface")
      const stroke = cell?.gap ? `stroke="${token("--color-critical-fg")}" stroke-dasharray="3 2" stroke-width="1.5"` : ""
      parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="3" fill="${fill}" ${stroke}/>`)
      const color = cell?.gap ? token("--color-critical-fg") : cell?.dark ? token("--color-surface") : token("--color-ink")
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
