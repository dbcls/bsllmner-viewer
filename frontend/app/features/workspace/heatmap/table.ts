export const HEATMAP_HEADER = [
  "row",
  "row_label",
  "col",
  "col_label",
  "count",
  "expected",
  "ratio",
  "residual",
  "classification",
  "row_total",
  "col_total",
  "total",
]

type TableElement = { value: string; label: string; count: number }
type TableCell = {
  row: string
  col: string
  count: number
  expected: number | null
  ratio: number | null
  residual: number | null
  classification?: string | null
}

/**
 * The rows of the TSV of a cross-tabulation, one per cell, with the values as the api gives them. Each row also contains
 * the total of its row, the total of its column, and the total of the table, which are not sums of the cells because one
 * item can be in several rows and columns.
 */
export const heatmapRows = (rows: readonly TableElement[], cols: readonly TableElement[], cells: readonly TableCell[], total: number): (string | number | null)[][] => {
  const rowOf = new Map(rows.map((r) => [r.value, r]))
  const colOf = new Map(cols.map((c) => [c.value, c]))
  return cells.map((c) => [
    c.row,
    rowOf.get(c.row)?.label ?? c.row,
    c.col,
    colOf.get(c.col)?.label ?? c.col,
    c.count,
    c.expected,
    c.ratio,
    c.residual,
    c.classification ?? "",
    rowOf.get(c.row)?.count ?? null,
    colOf.get(c.col)?.count ?? null,
    total,
  ])
}
