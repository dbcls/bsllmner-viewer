import { type ReactNode, useMemo, useState } from "react"

import { loadFailureProps } from "~/lib/api/client"
import { fetchTermChildren, queryFailed, useCrosstab, useDataset } from "~/lib/api/queries"
import type { Cell, Clause, Element, TermElement, TermHit } from "~/lib/api/types"
import { countScale, countScaleIsDark, logPosition, RATIO_STEPS, ratioScale, ratioScaleIsDark, token } from "~/lib/color"
import { downloadPngMarkup, downloadSvgMarkup, downloadTsv, FIGURE_SAVE_FAILED } from "~/lib/export"
import { figureFileName } from "~/lib/figure-style"
import { formatCount, formatRatio } from "~/lib/format"
import { fieldLabel, unitLabel } from "~/lib/labels"
import { MATRIX_PRESETS } from "~/lib/presets"
import { ACTION_ICON, busyClass, Card, CardHeader, Clickable, cn, EmptyNotice, ErrorNotice,HelpHint, Icon, InlineLabel, LinkButton, Segmented, Select, Skeleton, TableScroller, useFrozenEdge } from "~/ui"

import { AxisControls } from "../axis/axis-controls"
import { type AxisMemory, elementNoun, elementValidator, limitAlert, LOOKUP_FAILED, MAX_AXIS_TERMS, replaceTerms, resolvePasted, switchDimension, type TermLimit, toggleTerm } from "../axis/axis-terms"
import { AxisTermsDialog } from "../axis/axis-terms-dialog"
import { findTermId } from "../axis/find-term"
import { expectedElements } from "../expected-elements"
import { FigureExport } from "../figure-export"
import { type HeatmapColor, type Update, type WorkspaceState } from "../state"
import { TermIdHover } from "../term-id-hover"
import type { Condition } from "../use-condition"
import { useReplaceUnofferedDimensions } from "../use-offered-dimensions"
import { ViewControls } from "../view-controls"
import { crosstabAxes, crosstabDimensions, crosstabParams, HEATMAP_LIMIT } from "../view-requests"
import { COUNT_SCALE_TOKENS, type MatrixCell, type MatrixExport, matrixSvg, matrixSvgSize, ROW_INDENT } from "./matrix-svg"
import { type Guide, nestedUnder, openChildren, rowGuides, treePlaces } from "./row-tree"
import { HEATMAP_HEADER, heatmapRows } from "./table"

export type AxisSide = "row" | "col"

type HeatmapTabProps = {
  state: WorkspaceState
  condition: Condition
  update: Update
  /** Reads the latest state of the URL, which can be newer than `state` after an await. */
  latest: () => WorkspaceState
  /** Pasted entries are being resolved. The state outlives the view, as the user can leave the view and come back meanwhile. */
  replacing: boolean
  setReplacing: (replacing: boolean) => void
  onAlert: (message: string) => void
}

/** The api classifies only cells with at least this many expected matches, and the ratio of a cell with fewer is not colored. */
const EXPECTED_MIN = 5

/** The ratio of a cell that its color shows: null when the expected count is too small for the ratio to be stable. */
const coloredRatio = (cell: Cell | undefined): number | null =>
  cell !== undefined && cell.expected !== null && cell.expected >= EXPECTED_MIN ? cell.ratio : null

const ratioText = (cell: Cell): string => (cell.ratio === null ? "" : formatRatio(cell.ratio))

/** Cross-tabulation of two dimensions with expected counts, ratios to them, and gap marks. */
export const HeatmapTab = ({ state, condition, update, latest, replacing, setReplacing, onAlert }: HeatmapTabProps) => {
  const dataset = useDataset()
  useReplaceUnofferedDimensions(state, update, dataset)
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  // The term IDs follow the labels of the rows and of the columns that are annotation terms, when the charts show them.
  // The axes are the URL's, except a dimension that the dataset lacks, which another dimension replaces.
  const axes = crosstabAxes(state, dataset.data ? fields : null)
  const rowIds = state.termIds && fields.includes(axes.row)
  const colIds = state.termIds && fields.includes(axes.col)
  const dimensions = crosstabDimensions(fields).map((d) => ({ value: d, label: fieldLabel(d) }))
  /**
   * What each axis showed on the dimensions that it left, so that coming back to a dimension shows the terms chosen there.
   * The URL holds only the dimensions on screen, so this lasts as long as the page.
   */
  const [memory, setMemory] = useState<Record<AxisSide, AxisMemory>>({ row: {}, col: {} })
  /** The axis whose terms dialog is open. */
  const [termsSide, setTermsSide] = useState<AxisSide | null>(null)
  const crosstab = useCrosstab(crosstabParams(state, dataset.data ? fields : null))
  const data = crosstab.data
  const failed = queryFailed(crosstab)
  const nothing = data !== undefined && data.total === 0
  const pendingRows = data === undefined && !failed ? expectedElements(axes.row, dataset.data, HEATMAP_LIMIT, axes.rowTerms) : null
  const pendingCols = data === undefined && !failed ? expectedElements(axes.col, dataset.data, HEATMAP_LIMIT, axes.colTerms) : null
  const rows = useMemo(() => data?.rows ?? [], [data])
  const cols = useMemo(() => data?.cols ?? [], [data])

  const unit = unitLabel(state.unit)
  /** The table is the one of the previous condition, while the table of the new condition is on its way. */
  const stale = crosstab.isPlaceholderData
  const limitOf = (side: AxisSide): TermLimit => ({ max: MAX_AXIS_TERMS, subject: "A heatmap axis", noun: elementNoun(dimensionOf(side), fields) })

  /**
   * Narrow the condition to a cell: the population of the table plus the cell's row and column clauses. The view stays,
   * and selecting the cell again widens the condition back to the population of the table.
   */
  const narrowCell = (clauses: Clause[]) => {
    if (data && !stale) void condition.toggleNarrow(data.populationQ, clauses, state.q)
  }
  const max = Math.max(1, ...(data?.cells ?? []).map((c) => c.count))
  const cellByKey = new Map((data?.cells ?? []).map((c) => [`${c.row}\t${c.col}`, c]))

  /**
   * The terms of an axis: those that the URL names, when the user chose them, as the rows and columns on screen can still
   * be those of the previous terms while the cross-tabulation of the new ones is on its way.
   */
  const values = (side: AxisSide): string[] =>
    (side === "row" ? axes.rowTerms : axes.colTerms) ?? (side === "row" ? rows : cols).map((e) => e.value)
  // No terms left is the top terms.
  const setValues = (side: AxisSide, next: string[] | null) => {
    const terms = next?.length ? next : null
    update(side === "row" ? { rowTerms: terms } : { colTerms: terms })
  }
  const dimensionOf = (side: AxisSide) => (side === "row" ? axes.row : axes.col)

  /**
   * The tree of the rows, from the order of the rows in the URL and the parents that the api gives each of them, so that a
   * reload or a shared URL draws the same tree. Only rows open: the columns of a heatmap are too narrow to unfold.
   */
  const places = treePlaces(rows.map((row) => ({ value: row.value, parents: "parents" in row ? row.parents : [] })))
  /** A row is open while child terms hang under it. */
  const isOpen = (index: number) => places[index + 1]?.parent === rows[index]?.value
  /** The values of the rows that hang under the row at `index`, at every depth. */
  const nestedValues = (index: number) => nestedUnder(places, index).map((at) => rows[at]?.value ?? "")

  /** The rows whose children are on their way, so that a second press on a chevron waits for the first. */
  const [expanding, setExpanding] = useState<ReadonlySet<string>>(new Set())

  /** Shows the child terms of a row term under it, or takes them and the rows under them off the axis. */
  const toggleExpand = async (index: number) => {
    const value = rows[index]?.value
    if (value === undefined || !data || expanding.has(value)) return
    const current = values("row")
    if (isOpen(index)) {
      const removed = new Set(nestedValues(index))
      setValues("row", current.filter((v) => !removed.has(v)))
      return
    }
    const dimension = dimensionOf("row")
    setExpanding((previous) => new Set(previous).add(value))
    try {
      // The children are counted in the population of the table, as `hasChildren` is, so that a chevron always opens some.
      const result = await fetchTermChildren({
        field: dimension,
        termId: value,
        q: data.populationQ,
        unit: state.unit,
        selfExclusion: true,
      })
      const children = result.children.map((c) => c.value).filter((c) => c !== value)
      if (children.length === 0) {
        onAlert("No child terms with data.")
        return
      }
      // A child that is a row already, such as one that the user added, moves under its parent with the rows under it.
      const subtree = (child: string) => {
        const at = current.indexOf(child)
        return at < 0 ? [child] : [child, ...nestedValues(at)]
      }
      // The rows are those of the latest URL, which can hold another expansion that finished while this one waited.
      const now = latest()
      if (now.row !== state.row) return
      const base = now.rowTerms ?? current
      if (!base.includes(value)) return
      const opened = openChildren(base, value, children, subtree)
      if (opened.length > MAX_AXIS_TERMS) {
        onAlert(limitAlert(limitOf("row")))
        return
      }
      update({ rowTerms: opened })
    } catch {
      onAlert("Could not load the child terms.")
    } finally {
      setExpanding((previous) => {
        const next = new Set(previous)
        next.delete(value)
        return next
      })
    }
  }

  /** Makes the pasted entries the terms of the axis, in their order. A label becomes the term whose label it is, or else the first term found. */
  const replace = async (side: AxisSide, entries: string[]) => {
    const dimension = dimensionOf(side)
    const started = side === "row" ? state.row : state.col
    setReplacing(true)
    try {
      const result = await replaceTerms(entries, (list) => resolvePasted(list, fields.includes(dimension), (label) => findTermId(dimension, label, state.unit), elementValidator(dimension) ?? undefined), limitOf(side))
      // The terms belong to the dimension that the entries were resolved on; they are dropped when the axis moved to another one while they waited.
      const now = latest()
      if ((side === "row" ? now.row : now.col) !== started) return
      if (result.terms !== null) setValues(side, result.terms)
      onAlert(result.alert)
    } catch {
      onAlert(LOOKUP_FAILED)
    } finally {
      setReplacing(false)
    }
  }

  /** Takes a term, and on the rows the rows that hang under it in the tree on screen, off the axis. */
  const remove = (side: AxisSide, value: string) => {
    const at = side === "row" ? rows.findIndex((row) => row.value === value) : -1
    const under = at >= 0 ? nestedValues(at) : []
    setValues(side, values(side).filter((v) => v !== value && !under.includes(v)))
  }

  /** Adds a found term to the end of the axis, or takes it off when the axis has it. */
  const pick = (side: AxisSide, hit: TermHit) => {
    if (values(side).includes(hit.termId)) {
      remove(side, hit.termId)
      return
    }
    const result = toggleTerm(values(side), hit.termId, limitOf(side))
    if (result.alert !== null) onAlert(result.alert)
    else setValues(side, result.terms)
  }

  const changeDimension = (side: AxisSide, dimension: string) => {
    const current = { terms: side === "row" ? axes.rowTerms : axes.colTerms }
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
    // A heatmap that could not be loaded lists the terms of the URL, so that a term that the api refuses can be taken off.
    elements: failed ? (side === "row" ? axes.rowTerms : axes.colTerms)?.map((value) => ({ value, label: value })) ?? [] : side === "row" ? rows : cols,
    pending: side === "row" ? pendingRows : pendingCols,
    unknown: failed && (side === "row" ? axes.rowTerms : axes.colTerms) === null,
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

  /** The ground of a cell: white for a gap, whatever the scale says, on the page and in the saved figure. */
  const cellBackground = (gap: boolean, background: string): string => (gap ? token("--color-surface") : background)

  const exportCells = (): MatrixCell[] =>
    rows.flatMap((r) =>
      cols.map((c) => {
        const cell = cellByKey.get(`${r.value}\t${c.value}`)
        const style = cellStyle(cell)
        return {
          row: r.value,
          col: c.value,
          text: cell ? (state.color === "ratio" ? ratioText(cell) : formatCount(cell.count)) : "",
          background: cellBackground(cell?.classification === "gap", style.background),
          dark: style.dark,
          gap: cell?.classification === "gap",
          soft: softText(cell),
        }
      }),
    )
  const exportData = (): MatrixExport => ({
    rowLabels: rows.map((r, index) => ({ value: r.value, label: r.label, ...(rowIds ? { id: r.value } : {}), total: r.count, depth: places[index]?.depth ?? 0 })),
    colLabels: cols.map((c) => ({ value: c.value, label: c.label, ...(colIds ? { id: c.value } : {}), total: c.count })),
    cells: exportCells(),
    corner: { row: fieldLabel(axes.row), col: fieldLabel(axes.col) },
    total: data?.total ?? 0,
    title: `${fieldLabel(axes.row)} by ${fieldLabel(axes.col)}`,
    meta: `${unit}, ${state.color === "ratio" ? "Ratio to expected" : "Count"}`,
    legend: state.color === "ratio" ? { kind: "ratio" } : { kind: "count", max: formatCount(max) },
  })
  /** The TSV holds the count, the expected count, and the ratio whatever Cells is; only the images differ by it. */
  const fileName = (extension: "tsv" | "svg" | "png") =>
    figureFileName("heatmap", [axes.row, axes.col], state.unit, extension, extension !== "tsv" && state.color === "ratio" ? "ratio" : undefined)
  const exportTsv = () => downloadTsv(fileName("tsv"), HEATMAP_HEADER, heatmapRows(rows, cols, data?.cells ?? [], data?.total ?? 0))
  const exportSvg = () => void downloadSvgMarkup(fileName("svg"), matrixSvg(exportData())).catch(() => onAlert(FIGURE_SAVE_FAILED))
  const exportPng = () => {
    const figure = exportData()
    const size = matrixSvgSize(figure)
    void downloadPngMarkup(fileName("png"), matrixSvg(figure), size.width, size.height).catch(() => onAlert(FIGURE_SAVE_FAILED))
  }

  const gradient = `linear-gradient(90deg, ${COUNT_SCALE_TOKENS.map((name) => token(name)).join(", ")})`

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
                  update({ row: preset.state.row ?? axes.row, col: preset.state.col ?? axes.col, rowTerms: null, colTerms: null, unit: preset.state.unit ?? state.unit })
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
          <AxisControls name="Rows" selectLabel="Row dimension" {...axisProps("row")} noun={elementNoun(dimensionOf("row"), fields)} onOpenTerms={() => setTermsSide("row")} />
          <LinkButton
            tone="soft"
            size="md"
            icon={ACTION_ICON.swapAxes}
            onClick={() => {
              // The columns do not open, so the rows that hung under others become flat columns.
              setMemory((prev) => ({ row: prev.col, col: prev.row }))
              update({ row: axes.col, col: axes.row, rowTerms: axes.colTerms, colTerms: axes.rowTerms })
            }}
          >
            Swap axes
          </LinkButton>
          <AxisControls name="Columns" selectLabel="Column dimension" {...axisProps("col")} noun={elementNoun(dimensionOf("col"), fields)} onOpenTerms={() => setTermsSide("col")} />
        </div>
      </ViewControls>
      <AxisTermsDialog
        open={termsSide !== null}
        onClose={() => setTermsSide(null)}
        title={`${dialogSide === "col" ? "Column" : "Row"} ${elementNoun(dimensionOf(dialogSide), fields)}s`}
        {...axisProps(dialogSide)}
        unit={state.unit}
        selectedNote="✓ in axis"
        fields={fields}
        explicit={(dialogSide === "row" ? axes.rowTerms : axes.colTerms) !== null}
        limit={HEATMAP_LIMIT}
        q={data && !stale ? data.populationQ : state.q}
        onPick={(hit) => pick(dialogSide, hit)}
        onRemove={(value) => remove(dialogSide, value)}
        onReset={() => {
          setValues(dialogSide, null)
        }}
        onReplace={(entries) => void replace(dialogSide, entries)}
        replacing={replacing}
      />
      <Card padding="none" flush busy={crosstab.isPlaceholderData}>
        <CardHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex items-center">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {state.color === "count" ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    0<span className="inline-block h-2.5 w-25 rounded-badge" style={{ background: gradient }} />
                    {data === undefined ? failed ? "–" : <Skeleton className="w-12" /> : formatCount(max)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Swatch className="border border-border-soft bg-surface" /> ≤ {RATIO_STEPS.low}× <Swatch className="bg-brand-tint" /> &lt;{" "}
                    {RATIO_STEPS.mid}× <Swatch className="bg-brand-light" /> ≥ {RATIO_STEPS.mid}× <Swatch className="bg-brand" /> ≥ {RATIO_STEPS.high}×
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Swatch className="border-gap border-dashed border-critical-fg bg-surface" />
                  Gap
                </span>
              </div>
              <HelpHint label="About the heatmap">
                <span className="block">Expected: the count of a cell if the row and the column are independent (row total × column total ÷ total).</span>
                <span className="mt-1.5 block">
                  Ratio to expected: {RATIO_STEPS.mid}× is twice the expected count, {RATIO_STEPS.low}× is half. In this coloring, a cell with an expected count below {EXPECTED_MIN} has no color.
                </span>
                <span className="mt-1.5 block">Gap: a cell with a count of 0 and an expected count of {EXPECTED_MIN} or more.</span>
                <span className="mt-1.5 block">One item can be in several rows and columns, so the totals are not sums of the cells.</span>
              </HelpHint>
            </div>
            <FigureExport figure="heatmap" disabled={data === undefined || failed || stale || nothing} onTsv={exportTsv} onSvg={exportSvg} onPng={exportPng} />
          </div>
        </CardHeader>
        <TableScroller boxClassName="max-h-matrix-max overflow-auto">
          {failed && (
            <div className="p-4">
              <ErrorNotice {...loadFailureProps(crosstab.error, "load the heatmap", () => void crosstab.refetch())} />
            </div>
          )}
          {nothing && <EmptyNotice>No {unit} match this condition.</EmptyNotice>}
          {pendingRows !== null && pendingCols !== null && <SkeletonMatrix rows={pendingRows} cols={pendingCols} />}
          <table className={cn("min-w-full border-separate border-spacing-0.5 text-fs-label", (data === undefined || nothing) && "hidden")}>
            <thead>
              <tr>
                <FrozenHeading className="top-0 z-20 px-3.5 py-1.5 text-left align-bottom text-fs-micro font-semibold whitespace-nowrap text-ink-soft">
                  <span className="inline-flex gap-6">
                    <span>{fieldLabel(axes.row)} ↓</span>
                    <span>{fieldLabel(axes.col)} →</span>
                  </span>
                </FrozenHeading>
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
                <th className="sticky top-0 z-10 bg-surface py-1.5 pr-3.5 pl-2.5 text-right align-bottom text-fs-micro font-semibold text-ink-soft">Row total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const rowSelected = condition.isSelected(row.clauses)
                return (
                  <tr key={row.value}>
                    <FrozenHeading className={cn("z-10 px-3.5 py-1 text-left text-fs-label whitespace-nowrap", rowSelected ? "font-semibold" : "font-medium")}>
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
                    </FrozenHeading>
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
                        background: cellBackground(gap, style.background),
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
                              // Not disabled while the table of the new condition loads: a disabled button would lose the focus that pressed it.
                              onClick={stale ? undefined : () => narrowCell([...row.clauses, ...col.clauses])}
                              aria-disabled={stale || undefined}
                              className={cn(className, !stale && "cursor-pointer hover:outline-2 hover:outline-selection")}
                              style={cellStyleProps}
                            >
                              {text}
                            </Clickable>
                          )}
                        </td>
                      )
                    })}
                    <td className="pr-3.5 pl-2.5 text-right font-mono whitespace-nowrap text-ink-soft">{formatCount(row.count)}</td>
                  </tr>
                )
              })}
              {/* The column totals follow the last row as closely as the column labels precede the first, with no line and no
                  extra space: their grey numbers without cells set them apart from the rows. */}
              <tr>
                <FrozenHeading className="z-10 h-8 px-3.5 text-left text-fs-micro font-semibold text-ink-soft">Column total</FrozenHeading>
                {cols.map((col) => (
                  <td key={col.value} className="px-1.5 text-center font-mono text-ink-soft">
                    {formatCount(col.count)}
                  </td>
                ))}
                <td className="pr-3.5 pl-2.5 text-right font-mono font-medium text-ink-mid">{formatCount(data?.total ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        </TableScroller>
      </Card>
    </div>
  )
}

/** The matrix before the first cross-tabulation of a condition arrives: its headers and cells as skeletons, at their sizes. */
const SkeletonMatrix = ({ rows, cols }: { rows: number; cols: number }) => (
  <table aria-busy="true" className="min-w-full border-separate border-spacing-0.5 text-fs-label">
    <thead>
      <tr>
        <th className="px-3.5 py-2 text-left align-bottom text-fs-micro">
          <Skeleton className="w-28" />
        </th>
        {Array.from({ length: cols }, (_, index) => (
          <th key={index} className="min-w-heat-cell px-1 py-1.5 align-bottom text-fs-micro">
            <Skeleton className="w-14" />
          </th>
        ))}
        <th className="py-1.5 pr-3.5 pl-2.5 text-fs-micro">
          <Skeleton className="w-12" />
        </th>
      </tr>
    </thead>
    <tbody>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          <th className="px-3.5 py-1 text-left">
            <Skeleton className="w-24" />
          </th>
          {Array.from({ length: cols }, (_, col) => (
            <td key={col} className="p-0">
              <Skeleton kind="block" className="h-8 w-full min-w-heat-cell" />
            </td>
          ))}
          <td className="pr-3.5 pl-2.5">
            <Skeleton className="w-12" />
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)

/** A heading cell that stays at the left edge when the matrix scrolls sideways, and draws its edge once it has. The caller sets its `z-` layer. */
const FrozenHeading = ({ className, children }: { className: string; children: ReactNode }) => {
  const edge = useFrozenEdge()
  return <th className={cn("sticky left-0 bg-surface", edge, className)}>{children}</th>
}

/** The indent of a row term for each opened term above it. */
const INDENT = ROW_INDENT

const ROW_HEADING_PAD = 14
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
