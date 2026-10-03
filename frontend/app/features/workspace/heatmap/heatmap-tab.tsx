import { useMemo, useState } from "react"

import { api, unwrap } from "~/lib/api/client"
import { useCrosstab, useDataset } from "~/lib/api/queries"
import type { Cell, Clause, Element, TermElement, TermHit } from "~/lib/api/types"
import { countScale, countScaleIsDark, logPosition, ratioScale, ratioScaleIsDark, token } from "~/lib/color"
import { downloadPngMarkup, downloadSvgMarkup, downloadTsv } from "~/lib/export"
import { formatCount, formatRatio } from "~/lib/format"
import { fieldLabel, unitLabel } from "~/lib/labels"
import { MATRIX_PRESETS } from "~/lib/presets"
import { ACTION_ICON, busyClass, Card, CardHeader, Clickable, cn, HelpHint, Icon, InlineLabel, LinkButton, Segmented, Select, Skeleton } from "~/ui"

import { AxisControls } from "../axis/axis-controls"
import { type AxisMemory, resolvePasted, switchDimension } from "../axis/axis-terms"
import { AxisTermsDialog } from "../axis/axis-terms-dialog"
import { findTermId } from "../axis/find-term"
import { expectedElements } from "../expected-elements"
import { FigureExport } from "../figure-export"
import { type HeatmapColor, type Patch, type WorkspaceState } from "../state"
import { TermIdHover } from "../term-id-hover"
import type { Condition } from "../use-condition"
import { ViewControls } from "../view-controls"
import { type MatrixCell, matrixSvg, matrixSvgSize } from "./matrix-svg"
import { type Guide, nestedUnder, openChildren, rowGuides, treePlaces } from "./row-tree"

const AXIS_DIMENSIONS = ["library_strategy", "organism_id", "date_published"]

export type AxisSide = "row" | "col"

/** The number of elements per axis when the view names none. */
const LIMIT = 10

type HeatmapTabProps = {
  state: WorkspaceState
  condition: Condition
  update: (patch: Patch) => void
  onAlert: (message: string) => void
}

/** The api classifies only cells with at least this many expected matches, and the ratio of a cell with fewer is not colored. */
const EXPECTED_MIN = 5

/** The ratio of a cell that its color shows: null when the expected count is too small for the ratio to be stable. */
const coloredRatio = (cell: Cell | undefined): number | null =>
  cell !== undefined && cell.expected !== null && cell.expected >= EXPECTED_MIN ? cell.ratio : null

const ratioText = (cell: Cell): string => (cell.ratio === null ? "" : formatRatio(cell.ratio))

/** Cross-tabulation of two dimensions with expected counts, ratios to them, and gap marks. */
export const HeatmapTab = ({ state, condition, update, onAlert }: HeatmapTabProps) => {
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  // The term IDs follow the labels of the rows and of the columns that are annotation terms, when the charts show them.
  const rowIds = state.termIds && fields.includes(state.row)
  const colIds = state.termIds && fields.includes(state.col)
  const dimensions = [...fields, ...AXIS_DIMENSIONS].map((d) => ({ value: d, label: fieldLabel(d) }))
  /**
   * What each axis showed on the dimensions that it left, so that coming back to a dimension shows the terms chosen there.
   * The URL holds only the dimensions on screen, so this lasts as long as the page.
   */
  const [memory, setMemory] = useState<Record<AxisSide, AxisMemory>>({ row: {}, col: {} })
  /** The axis whose terms dialog is open. */
  const [termsSide, setTermsSide] = useState<AxisSide | null>(null)
  const crosstab = useCrosstab({
    row: state.row,
    col: state.col,
    q: state.q,
    unit: state.unit,
    selfExclusion: true,
    ...(state.rowTerms ? { rowElements: state.rowTerms.join(",") } : {}),
    ...(state.colTerms ? { colElements: state.colTerms.join(",") } : {}),
    limit: LIMIT,
  })
  const data = crosstab.data
  const pendingRows = data === undefined ? expectedElements(state.row, dataset.data, LIMIT, state.rowTerms) : null
  const pendingCols = data === undefined ? expectedElements(state.col, dataset.data, LIMIT, state.colTerms) : null
  const rows = useMemo(() => data?.rows ?? [], [data])
  const cols = useMemo(() => data?.cols ?? [], [data])

  const unit = unitLabel(state.unit)

  /**
   * Narrow the condition to a cell: the population of the table plus the cell's row and column clauses. The view stays,
   * and selecting the cell again widens the condition back to the population of the table.
   */
  const narrowCell = (clauses: Clause[]) => {
    if (data) void condition.toggleNarrow(data.populationQ, clauses)
  }
  const max = Math.max(1, ...(data?.cells ?? []).map((c) => c.count))
  const cellByKey = new Map((data?.cells ?? []).map((c) => [`${c.row}\t${c.col}`, c]))

  const values = (side: AxisSide): string[] => (side === "row" ? rows : cols).map((e) => e.value)
  const setValues = (side: AxisSide, next: string[] | null) => update(side === "row" ? { rowTerms: next } : { colTerms: next })
  const dimensionOf = (side: AxisSide) => (side === "row" ? state.row : state.col)

  /**
   * The tree of the rows, from the order of the rows in the URL and the parents that the api gives each of them, so that a
   * reload or a shared URL draws the same tree. Only rows open: the columns of a heatmap are too narrow to unfold.
   */
  const places = treePlaces(rows.map((row) => ({ value: row.value, parents: "parents" in row ? row.parents : [] })))
  /** A row is open while child terms hang under it. */
  const isOpen = (index: number) => places[index + 1]?.parent === rows[index]?.value
  /** The values of the rows that hang under the row at `index`, at every depth. */
  const nestedValues = (index: number) => nestedUnder(places, index).map((at) => rows[at]?.value ?? "")

  /** Shows the child terms of a row term under it, or takes them and the rows under them off the axis. */
  const toggleExpand = async (index: number) => {
    const value = rows[index]?.value
    if (value === undefined || !data) return
    const current = values("row")
    if (isOpen(index)) {
      const removed = new Set(nestedValues(index))
      setValues("row", current.filter((v) => !removed.has(v)))
      return
    }
    // The children are counted in the population of the table, as `hasChildren` is, so that a chevron always opens some.
    const result = unwrap(
      await api.GET("/api/terms/children", {
        params: {
          query: {
            field: dimensionOf("row"),
            termId: value,
            ...(data.populationQ ? { q: data.populationQ } : {}),
            unit: state.unit,
            facetSelfExclude: true,
          },
        },
      }),
    )
    const children = result.children.map((c) => c.value).filter((c) => c !== value)
    if (children.length === 0) {
      onAlert("No child terms with data")
      return
    }
    // A child that is a row already, such as one that the user added, moves under its parent with the rows under it.
    const subtree = (child: string) => {
      const at = current.indexOf(child)
      return at < 0 ? [child] : [child, ...nestedValues(at)]
    }
    setValues("row", openChildren(current, value, children, subtree))
  }

  /** Makes the pasted entries the terms of the axis, in their order. A label becomes the term whose label it is, or else the first term found. */
  const replace = async (side: AxisSide, entries: string[]) => {
    const dimension = dimensionOf(side)
    const unique = await resolvePasted(entries, fields.includes(dimension), (label) => findTermId(dimension, label))
    if (unique.length === 0) {
      onAlert("No terms recognised")
      return
    }
    setValues(side, unique)
    onAlert(`${unique.length} of ${entries.length} terms recognised`)
  }

  /** Takes a term, and on the rows the rows that hang under it, off the axis. */
  const remove = (side: AxisSide, value: string) => {
    const at = values(side).indexOf(value)
    const under = side === "row" && at >= 0 ? nestedValues(at) : []
    setValues(side, values(side).filter((v) => v !== value && !under.includes(v)))
  }

  /** Adds a found term to the end of the axis, or takes it off when the axis has it. */
  const pick = (side: AxisSide, hit: TermHit) => {
    if (values(side).includes(hit.termId)) remove(side, hit.termId)
    else setValues(side, [...values(side), hit.termId])
  }

  const changeDimension = (side: AxisSide, dimension: string) => {
    const current = { terms: side === "row" ? state.rowTerms : state.colTerms }
    const switched = switchDimension(memory[side], dimensionOf(side), dimension, current)
    setMemory((prev) => ({ ...prev, [side]: switched.memory }))
    update(side === "row" ? { row: dimension, rowTerms: switched.next.terms } : { col: dimension, colTerms: switched.next.terms })
  }

  /** The dimensions that an axis can take: every dimension but the other axis's, as a dimension against itself shows nothing. */
  const dimensionsOf = (side: AxisSide) => dimensions.filter((d) => d.value !== dimensionOf(side === "row" ? "col" : "row"))

  /** A row term that has child terms with matches in the population, or that is open, opens and closes from its heading. */
  const expandable = (element: Element | TermElement, index: number): boolean =>
    ("hasChildren" in element && element.hasChildren) || isOpen(index)

  /** When a row opens, a row that does not keeps the place of the chevron, so that every label of a level starts at one x. */
  const rowsExpandable = rows.some(expandable)
  const guides = rowGuides(places.map((place) => place.depth))

  const axisProps = (side: AxisSide) => ({
    dimension: dimensionOf(side),
    dimensions: dimensionsOf(side),
    elements: side === "row" ? rows : cols,
    pending: side === "row" ? pendingRows : pendingCols,
    onDimension: (dimension: string) => changeDimension(side, dimension),
  })

  /** The axis that the terms dialog shows; while the dialog is closed, it draws nothing whatever the axis. */
  const dialogSide = termsSide ?? "row"

  const cellStyle = (cell: Cell | undefined) => {
    if (!cell) return { background: token("--color-surface"), dark: false }
    if (state.color === "ratio") {
      const ratio = coloredRatio(cell)
      return { background: ratioScale(ratio), dark: ratioScaleIsDark(ratio) }
    }
    const t = logPosition(cell.count, max)
    return { background: cell.count > 0 ? countScale(t) : token("--color-surface-subtle"), dark: countScaleIsDark(t) }
  }

  /** Whether the text of a cell is in the grey of the page: a 0 that is not a gap, or a ratio that the color does not show. */
  const softText = (cell: Cell | undefined): boolean =>
    cell?.classification !== "gap" && (!cell || cell.count === 0 || (state.color === "ratio" && coloredRatio(cell) === null))

  const exportCells = (): MatrixCell[] =>
    rows.flatMap((r) =>
      cols.map((c) => {
        const cell = cellByKey.get(`${r.value}\t${c.value}`)
        const style = cellStyle(cell)
        return {
          row: r.value,
          col: c.value,
          text: cell ? (state.color === "ratio" ? ratioText(cell) : formatCount(cell.count)) : "",
          background: style.background,
          dark: style.dark,
          gap: cell?.classification === "gap",
          soft: softText(cell),
        }
      }),
    )
  const exportData = () => ({
    rowLabels: rows.map((r) => ({ value: r.value, label: r.label, ...(rowIds ? { id: r.value } : {}), total: r.count })),
    colLabels: cols.map((c) => ({ value: c.value, label: c.label, ...(colIds ? { id: c.value } : {}), total: c.count })),
    cells: exportCells(),
    corner: { row: fieldLabel(state.row), col: fieldLabel(state.col) },
    total: data?.total ?? 0,
  })
  const exportTsv = () =>
    downloadTsv(
      `${state.row}-x-${state.col}.tsv`,
      ["row", "row_label", "col", "col_label", unit.toLowerCase(), "expected", "ratio", "residual", "classification"],
      (data?.cells ?? []).map((c) => [
        c.row,
        rows.find((r) => r.value === c.row)?.label ?? c.row,
        c.col,
        cols.find((x) => x.value === c.col)?.label ?? c.col,
        c.count,
        c.expected === null ? "" : c.expected.toFixed(2),
        c.ratio === null ? "" : c.ratio.toFixed(3),
        c.residual === null ? "" : c.residual.toFixed(3),
        c.classification ?? "",
      ]),
    )
  const exportSvg = () => downloadSvgMarkup(`${state.row}-x-${state.col}.svg`, matrixSvg(exportData()))
  const exportPng = () => {
    const data = exportData()
    const size = matrixSvgSize(data)
    void downloadPngMarkup(`${state.row}-x-${state.col}.png`, matrixSvg(data), size.width, size.height)
  }

  const gradient = `linear-gradient(90deg, ${token("--color-brand-soft")}, ${token("--color-brand-light")}, ${token("--color-brand")}, ${token("--color-brand-deeper")})`

  return (
    <div>
      <ViewControls
        unit={state.unit}
        onUnit={(unit) => update({ unit })}
        termIds={state.termIds}
        onTermIds={() => update({ termIds: !state.termIds })}
        controls={
          <>
            <span className="inline-flex items-center gap-1.5">
              <InlineLabel>Cells</InlineLabel>
              <Segmented
                ariaLabel="Cells"
                options={[
                  { value: "count", label: "Count" },
                  { value: "ratio", label: "Ratio to expected" },
                ]}
                value={state.color}
                onChange={(color: HeatmapColor) => update({ color })}
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <InlineLabel>Preset</InlineLabel>
              <Select
                size="sm"
                placeholder="Choose…"
                options={MATRIX_PRESETS.map((p) => ({ value: p.id, label: p.title }))}
                value=""
                onChange={(id) => {
                  const preset = MATRIX_PRESETS.find((p) => p.id === id)
                  if (!preset) return
                  update({ row: preset.state.row ?? state.row, col: preset.state.col ?? state.col, rowTerms: null, colTerms: null, unit: preset.state.unit ?? state.unit })
                }}
                aria-label="Preset"
              />
            </span>
          </>
        }
      >
        <div
          aria-busy={crosstab.isPlaceholderData || undefined}
          className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 text-fs-label text-ink-soft", busyClass(crosstab.isPlaceholderData))}
        >
          {/* The two axes are set apart by wide space, with Swap axes between them as plain text, so that the row reads as two settings and not as five. */}
          <AxisControls name="Rows" selectLabel="Row dimension" {...axisProps("row")} onOpenTerms={() => setTermsSide("row")} />
          <LinkButton
            tone="soft"
            size="md"
            icon={ACTION_ICON.swapAxes}
            onClick={() => {
              // The columns do not open, so the rows that hung under others become flat columns.
              setMemory((prev) => ({ row: prev.col, col: prev.row }))
              update({ row: state.col, col: state.row, rowTerms: state.colTerms, colTerms: state.rowTerms })
            }}
          >
            Swap axes
          </LinkButton>
          <AxisControls name="Columns" selectLabel="Column dimension" {...axisProps("col")} onOpenTerms={() => setTermsSide("col")} />
        </div>
      </ViewControls>
      <AxisTermsDialog
        open={termsSide !== null}
        onClose={() => setTermsSide(null)}
        title={dialogSide === "col" ? "Column terms" : "Row terms"}
        {...axisProps(dialogSide)}
        selectedNote="✓ in axis"
        fields={fields}
        explicit={(dialogSide === "row" ? state.rowTerms : state.colTerms) !== null}
        limit={LIMIT}
        q={state.q}
        onPick={(hit) => pick(dialogSide, hit)}
        onRemove={(value) => remove(dialogSide, value)}
        onReset={() => {
          setValues(dialogSide, null)
        }}
        onReplace={(entries) => void replace(dialogSide, entries)}
      />
      <Card padding="none" flush busy={crosstab.isPlaceholderData}>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex items-center">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {state.color === "count" ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    0<span className="inline-block h-2.5 w-25 rounded-badge" style={{ background: gradient }} />
                    {data === undefined ? <Skeleton className="w-12" /> : formatCount(max)}
                    {state.unit !== "biosample" && <span>{unit}</span>}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Swatch className="border border-border-soft bg-surface" /> ≤ 0.5× <Swatch className="bg-brand-tint" /> &lt; 2×{" "}
                    <Swatch className="bg-brand-light" /> ≥ 2× <Swatch className="bg-brand" /> ≥ 4×
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-3.5 w-5.5 rounded-badge border-gap border-dashed border-critical-fg bg-surface" />
                  Gap
                </span>
              </div>
              <HelpHint label="About the heatmap">
                <span className="block">Expected: the count if the row and the column were unrelated (row total × column total ÷ total).</span>
                <span className="mt-1.5 block">
                  Ratio to expected: 2× is twice the expected count, 0.5× is half. Cells with fewer than 5 expected are not colored.
                </span>
                <span className="mt-1.5 block">Gap: 0 where 5 or more are expected.</span>
                <span className="mt-1.5 block">A BioSample can be in several rows and columns, so the totals are not sums of the cells.</span>
              </HelpHint>
            </div>
            <FigureExport figure="heatmap" onTsv={exportTsv} onSvg={exportSvg} onPng={exportPng} />
          </div>
        </CardHeader>
        <div className="max-h-matrix-max overflow-auto">
          {pendingRows !== null && pendingCols !== null && <SkeletonMatrix rows={pendingRows} cols={pendingCols} />}
          <table className={cn("min-w-full border-separate border-spacing-0.5 text-fs-label", data === undefined && "hidden")}>
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 bg-surface px-2.5 py-1.5 text-left align-bottom text-fs-micro font-semibold whitespace-nowrap text-ink-soft">
                  <span className="inline-flex gap-6">
                    <span>{fieldLabel(state.row)} ↓</span>
                    <span>{fieldLabel(state.col)} →</span>
                  </span>
                </th>
                {cols.map((col) => (
                  <th
                    key={col.value}
                    // A column with its term ID is at least as wide as the ID (0.6em a character of the monospace font) with
                    // 8px on each side, padding included, past the usual width of a column, so that the IDs of two columns do
                    // not run together.
                    style={colIds ? { minWidth: `calc(${col.value.length * 0.6}em + 16px)` } : undefined}
                    className="sticky top-0 z-10 max-w-heat-head min-w-heat-cell bg-surface px-1 py-1.5 align-bottom text-fs-micro leading-snug font-medium text-balance"
                  >
                    {col.label}
                    {colIds && <TermIdHover termId={col.value} label={col.label} className="block whitespace-nowrap" />}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-surface px-2 py-1.5 text-right align-bottom text-fs-micro font-semibold text-ink-soft">Row total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const rowSelected = condition.isSelected(row.clauses)
                return (
                  <tr key={row.value}>
                    <th
                      className={cn("sticky left-0 z-10 bg-surface px-2.5 py-1 text-left text-fs-label whitespace-nowrap", rowSelected ? "font-semibold" : "font-medium")}
                    >
                      {(guides[rowIndex] ?? []).map((guide) => (
                        <GuideLine key={`${guide.level}:${guide.kind}`} guide={guide} toLabel={!expandable(row, rowIndex)} />
                      ))}
                      <span className="flex items-center" style={{ paddingLeft: (places[rowIndex]?.depth ?? 0) * INDENT }}>
                        {expandable(row, rowIndex) ? (
                          <Clickable
                            onClick={() => void toggleExpand(rowIndex)}
                            aria-expanded={isOpen(rowIndex)}
                            className="-my-0.5 -ml-0.5 inline-flex cursor-pointer items-center gap-1 rounded-tag py-0.5 pr-1.5 pl-0.5 hover:bg-brand-soft"
                          >
                            <Icon name={isOpen(rowIndex) ? ACTION_ICON.hideChildren : ACTION_ICON.showChildren} className="text-ink-soft" />
                            {row.label}
                            {rowIds && <TermIdHover termId={row.value} label={row.label} />}
                          </Clickable>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {rowsExpandable && <span className="inline-block w-3.5" />}
                            {row.label}
                            {rowIds && <TermIdHover termId={row.value} label={row.label} />}
                          </span>
                        )}
                      </span>
                    </th>
                    {cols.map((col) => {
                      const cell = cellByKey.get(`${row.value}\t${col.value}`)
                      const style = cellStyle(cell)
                      const gap = cell?.classification === "gap"
                      const selected = rowSelected && condition.isSelected(col.clauses)
                      const text = !cell ? "" : state.color === "ratio" ? ratioText(cell) : formatCount(cell.count)
                      const empty = !cell || cell.count === 0
                      const className = cn(
                        "flex h-8 w-full min-w-heat-cell items-center justify-center rounded-badge border px-1.5 font-mono text-fs-label",
                        gap && "border-gap border-dashed border-critical-fg font-semibold text-critical-fg",
                        !gap && "border-transparent",
                        softText(cell) && "text-ink-soft",
                        selected && "outline-2 outline-selection",
                      )
                      const cellStyleProps = {
                        background: gap ? token("--color-surface") : style.background,
                        color: gap ? undefined : style.dark ? token("--color-surface") : undefined,
                      }
                      return (
                        <td key={col.value} className="p-0" aria-label={`${row.label} × ${col.label}: ${text}`}>
                          {empty ? (
                            <div className={className} style={cellStyleProps}>
                              {text}
                            </div>
                          ) : (
                            <Clickable
                              aria-label={`${row.label} × ${col.label}: ${text}. Narrow the condition to this cell`}
                              aria-pressed={selected}
                              onClick={() => narrowCell([...row.clauses, ...col.clauses])}
                              className={cn(className, "cursor-pointer hover:outline-2 hover:outline-selection")}
                              style={cellStyleProps}
                            >
                              {text}
                            </Clickable>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-2.5 text-right font-mono whitespace-nowrap text-ink-soft">{formatCount(row.count)}</td>
                  </tr>
                )
              })}
              {/* The column totals follow the last row as closely as the column labels precede the first, with no line and no
                  extra space: their grey numbers without cells set them apart from the rows. */}
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-2.5 py-2 text-left text-fs-micro font-semibold text-ink-soft">Column total</th>
                {cols.map((col) => (
                  <td key={col.value} className="p-1.5 text-center font-mono text-ink-soft">
                    {formatCount(col.count)}
                  </td>
                ))}
                <td className="px-2.5 py-1.5 text-right font-mono font-medium text-ink-mid">{formatCount(data?.total ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/** The matrix before the first cross-tabulation of a condition arrives: its headers and cells as skeletons, at their sizes. */
const SkeletonMatrix = ({ rows, cols }: { rows: number; cols: number }) => (
  <table aria-busy="true" className="min-w-full border-separate border-spacing-0.5 text-fs-label">
    <thead>
      <tr>
        <th className="px-2.5 py-2 text-left align-bottom text-fs-micro">
          <Skeleton className="w-28" />
        </th>
        {Array.from({ length: cols }, (_, index) => (
          <th key={index} className="min-w-heat-cell px-1 py-1.5 align-bottom text-fs-micro">
            <Skeleton className="w-14" />
          </th>
        ))}
        <th className="px-2 py-1.5 text-fs-micro">
          <Skeleton className="w-12" />
        </th>
      </tr>
    </thead>
    <tbody>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          <th className="px-2.5 py-1 text-left">
            <Skeleton className="w-24" />
          </th>
          {Array.from({ length: cols }, (_, col) => (
            <td key={col} className="p-0">
              <Skeleton kind="block" className="h-8 w-full min-w-heat-cell" />
            </td>
          ))}
          <td className="px-2.5">
            <Skeleton className="w-12" />
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)

/** The indent of a row term for each opened term above it. */
const INDENT = 18

const ROW_HEADING_PAD = 10
/** The chevron of a row heading: 1.1em of the 12px heading. */
const CHEVRON_SIZE = 13.2
/** Where the 1px lines of a level start, from the edge of the row heading: centered under the chevron of that level. */
const lineX = (level: number) => ROW_HEADING_PAD + level * INDENT + CHEVRON_SIZE / 2 - 0.5
/** The place of the chevron and the space after it, which the bend crosses to reach the label of a row without one. */
const CHEVRON_PLACE = 16

/**
 * One line of the tree that ties a child term to its parent (`rowGuides`). The lines are thin and light, and a line bends
 * to its child with a rounded corner, up to the chevron of the child, or up to its label when it has no chevron. They
 * reach 1px past the row into the space between rows, so that the lines of adjacent rows join.
 */
const GuideLine = ({ guide, toLabel }: { guide: Guide; toLabel: boolean }) => {
  const left = lineX(guide.level)
  const line = "pointer-events-none absolute border-border-soft"
  const width = INDENT - CHEVRON_SIZE / 2 - 2 + (toLabel ? CHEVRON_PLACE : 0)
  // The bottom edge of the bend is centered on the middle of the row, where the chevron and the label are.
  const bend = <span className={cn(line, "-top-px rounded-bl-button border-b border-l")} style={{ left, width, height: "calc(50% + 1.5px)" }} />
  switch (guide.kind) {
    case "stem":
      // From just under the circle of the chevron, whose radius is 10/24 of its size.
      return <span className={cn(line, "-bottom-px border-l")} style={{ left, top: `calc(50% + ${Math.ceil((CHEVRON_SIZE * 10) / 24) + 1}px)` }} />
    case "pass":
      return <span className={cn(line, "-top-px -bottom-px border-l")} style={{ left }} />
    case "branch":
      return (
        <>
          <span className={cn(line, "-top-px -bottom-px border-l")} style={{ left }} />
          {bend}
        </>
      )
    case "last":
      return bend
  }
}

const Swatch = ({ className }: { className: string }) => <span className={cn("inline-block h-3.5 w-5.5 rounded-badge", className)} />
