import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router"

import { api, unwrap } from "~/lib/api/client"
import { useCrosstab, useDataset } from "~/lib/api/queries"
import type { Cell, Clause } from "~/lib/api/types"
import { countScale, countScaleIsDark, logPosition, residualScale, residualScaleIsDark, token } from "~/lib/color"
import { downloadPngMarkup, downloadSvgMarkup, downloadTsv } from "~/lib/export"
import { formatCount, formatResidual } from "~/lib/format"
import { fieldLabel, unitLabel } from "~/lib/labels"
import { MATRIX_PRESETS } from "~/lib/presets"
import { Card, CardFooter, CardHeader, Clickable, cn, LinkButton, Segmented, Select, Tag } from "~/ui"

import { type HeatmapColor, type Patch, workspaceSearch, type WorkspaceState } from "../state"
import type { Condition } from "../use-condition"
import { AxisCard, type AxisSide } from "./axis-card"
import { type MatrixCell, matrixSvg, matrixSvgSize } from "./matrix-svg"

const AXIS_DIMENSIONS = ["library_strategy", "organism_id", "date_created"]

type HeatmapTabProps = {
  state: WorkspaceState
  condition: Condition
  update: (patch: Patch) => void
  onOpenPicker: (side: AxisSide, field: string) => void
  onAxisElements: (side: AxisSide, values: string[]) => void
  onToast: (message: string) => void
}

type Expansions = Record<string, string[]>

const CLASS_LABEL: Record<string, string> = { gap: "gap", under: "under-represented", over: "over-represented" }

/** Cross-tabulation of two dimensions with expected counts, residuals, and gap marks. */
export const HeatmapTab = ({ state, condition, update, onOpenPicker, onAxisElements, onToast }: HeatmapTabProps) => {
  const navigate = useNavigate()
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const dimensions = [...fields, ...AXIS_DIMENSIONS].map((d) => ({ value: d, label: fieldLabel(d) }))
  const [expansions, setExpansions] = useState<Record<AxisSide, Expansions>>({ row: {}, col: {} })
  const crosstab = useCrosstab({
    row: state.row,
    col: state.col,
    q: state.q,
    unit: state.unit,
    selfExclusion: state.selfExclusion,
    ...(state.rowTerms ? { rowElements: state.rowTerms.join(",") } : {}),
    ...(state.colTerms ? { colElements: state.colTerms.join(",") } : {}),
    limit: 10,
  })
  const data = crosstab.data
  const rows = useMemo(() => data?.rows ?? [], [data])
  const cols = useMemo(() => data?.cols ?? [], [data])

  useEffect(() => {
    onAxisElements("row", rows.map((r) => r.value))
    onAxisElements("col", cols.map((c) => c.value))
  }, [rows, cols, onAxisElements])

  const unit = unitLabel(state.unit)
  const excluded = data !== undefined && data.populationQ !== data.q

  /** Open the record list narrowed to a cell: the population of the table plus the cell's row and column clauses. */
  const openCell = async (clauses: Clause[]) => {
    if (!data) return
    const q = await condition.narrowed(data.populationQ, clauses)
    await navigate(`/entries${workspaceSearch({ ...state, q, tab: "samples", page: 1 })}`)
  }
  const max = Math.max(1, ...(data?.cells ?? []).map((c) => c.count))
  const cellByKey = new Map((data?.cells ?? []).map((c) => [`${c.row}\t${c.col}`, c]))

  const depthOf = (side: AxisSide) => (value: string): number => {
    let depth = 0
    let current = value
    const map = expansions[side]
    for (let guard = 0; guard < 16; guard += 1) {
      const parent = Object.keys(map).find((p) => map[p]?.includes(current))
      if (!parent) break
      depth += 1
      current = parent
    }
    return depth
  }

  const values = (side: AxisSide): string[] => (side === "row" ? rows : cols).map((e) => e.value)
  const setValues = (side: AxisSide, next: string[] | null) => update(side === "row" ? { rowTerms: next } : { colTerms: next })
  const dimensionOf = (side: AxisSide) => (side === "row" ? state.row : state.col)

  const descendants = (side: AxisSide, value: string): string[] => {
    const children = expansions[side][value] ?? []
    return children.flatMap((c) => [c, ...descendants(side, c)])
  }

  const toggleExpand = async (side: AxisSide, value: string) => {
    const dimension = dimensionOf(side)
    const current = values(side)
    if (expansions[side][value]) {
      const removed = new Set(descendants(side, value))
      setExpansions((prev) => {
        const dropped = new Set([value, ...removed])
        const next = Object.fromEntries(Object.entries(prev[side]).filter(([key]) => !dropped.has(key)))
        return { ...prev, [side]: next }
      })
      setValues(side, current.filter((v) => !removed.has(v)))
      return
    }
    const result = unwrap(
      await api.GET("/api/terms/children", {
        params: {
          query: {
            field: dimension,
            termId: value,
            ...(state.q ? { q: state.q } : {}),
            unit: state.unit,
            facetSelfExclude: state.selfExclusion,
          },
        },
      }),
    )
    const children = result.children.map((c) => c.value).filter((c) => !current.includes(c))
    if (children.length === 0) {
      onToast("No child terms with data")
      return
    }
    setExpansions((prev) => ({ ...prev, [side]: { ...prev[side], [value]: children } }))
    const index = current.indexOf(value)
    setValues(side, [...current.slice(0, index + 1), ...children, ...current.slice(index + 1)])
  }

  const paste = async (side: AxisSide, lines: string[]) => {
    const dimension = dimensionOf(side)
    const found: string[] = []
    for (const line of lines) {
      if (!fields.includes(dimension) || line.includes(":")) {
        found.push(line)
        continue
      }
      const hits = unwrap(
        await api.GET("/api/terms", { params: { query: { field: dimension, query: line, facetSelfExclude: true, limit: 5 } } }),
      ).terms
      const exact = hits.find((h) => (h.label ?? "").toLowerCase() === line.toLowerCase()) ?? hits[0]
      if (exact) found.push(exact.termId)
    }
    const unique = [...new Set(found)]
    if (unique.length === 0) {
      onToast("No terms recognised")
      return
    }
    setExpansions((prev) => ({ ...prev, [side]: {} }))
    setValues(side, unique)
    onToast(`${unique.length} of ${lines.length} terms recognised`)
  }

  const changeDimension = (side: AxisSide, dimension: string) => {
    setExpansions((prev) => ({ ...prev, [side]: {} }))
    update(side === "row" ? { row: dimension, rowTerms: null } : { col: dimension, colTerms: null })
  }

  const cellStyle = (cell: Cell | undefined) => {
    if (!cell) return { background: token("--color-surface"), dark: false }
    if (state.color === "residual") {
      return { background: residualScale(cell.residual), dark: residualScaleIsDark(cell.residual) }
    }
    const t = logPosition(cell.count, max)
    return { background: cell.count > 0 ? countScale(t) : token("--color-surface-subtle"), dark: countScaleIsDark(t) }
  }

  const exportCells = (): MatrixCell[] =>
    rows.flatMap((r) =>
      cols.map((c) => {
        const cell = cellByKey.get(`${r.value}\t${c.value}`)
        const style = cellStyle(cell)
        return {
          row: r.value,
          col: c.value,
          text: cell ? (state.color === "residual" ? formatResidual(cell.residual) : formatCount(cell.count)) : "",
          background: style.background,
          dark: style.dark,
          gap: cell?.classification === "gap",
        }
      }),
    )
  const exportData = () => ({
    rowLabels: rows.map((r) => ({ value: r.value, label: r.label, total: r.count })),
    colLabels: cols.map((c) => ({ value: c.value, label: c.label, total: c.count })),
    cells: exportCells(),
    corner: `${fieldLabel(state.row)} ↓ · ${fieldLabel(state.col)} →`,
    total: data?.total ?? 0,
  })
  const exportTsv = () =>
    downloadTsv(
      `${state.row}-x-${state.col}.tsv`,
      ["row", "row_label", "col", "col_label", unit.toLowerCase(), "expected", "residual", "classification"],
      (data?.cells ?? []).map((c) => [
        c.row,
        rows.find((r) => r.value === c.row)?.label ?? c.row,
        c.col,
        cols.find((x) => x.value === c.col)?.label ?? c.col,
        c.count,
        c.expected === null ? "" : c.expected.toFixed(2),
        c.residual === null ? "" : c.residual.toFixed(3),
        c.classification ?? "",
      ]),
    )
  const exportSvg = () => downloadSvgMarkup(`${state.row}-x-${state.col}.svg`, matrixSvg(exportData()))
  const exportPng = () => {
    const size = matrixSvgSize(rows.length, cols.length)
    void downloadPngMarkup(`${state.row}-x-${state.col}.png`, matrixSvg(exportData()), size.width, size.height)
  }

  const gradient = `linear-gradient(90deg, ${token("--color-brand-soft")}, ${token("--color-brand-light")}, ${token("--color-brand")}, ${token("--color-brand-deeper")})`

  return (
    <div>
      <div className="mb-3.5 grid grid-cols-2 gap-3.5">
        {(["row", "col"] as const).map((side) => (
          <AxisCard
            key={side}
            side={side}
            dimension={dimensionOf(side)}
            dimensions={dimensions}
            elements={side === "row" ? rows : cols}
            explicit={(side === "row" ? state.rowTerms : state.colTerms) !== null}
            expanded={new Set(Object.keys(expansions[side]))}
            depthOf={depthOf(side)}
            onDimension={(dimension) => changeDimension(side, dimension)}
            onAdd={() => onOpenPicker(side, dimensionOf(side))}
            onPaste={(lines) => void paste(side, lines)}
            onReset={() => {
              setExpansions((prev) => ({ ...prev, [side]: {} }))
              setValues(side, null)
            }}
            onRemove={(value) => setValues(side, values(side).filter((v) => v !== value && !descendants(side, value).includes(v)))}
            onToggleExpand={(value) => void toggleExpand(side, value)}
          />
        ))}
      </div>
      <Card padding="none" flush>
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <span>Preset</span>
              <Select
                size="sm"
                placeholder="Choose…"
                options={MATRIX_PRESETS.map((p) => ({ value: p.id, label: p.title }))}
                value=""
                onChange={(id) => {
                  const preset = MATRIX_PRESETS.find((p) => p.id === id)
                  if (!preset) return
                  setExpansions({ row: {}, col: {} })
                  update({ row: preset.state.row ?? state.row, col: preset.state.col ?? state.col, rowTerms: null, colTerms: null, unit: preset.state.unit ?? state.unit })
                }}
                aria-label="Preset"
              />
              <LinkButton
                onClick={() => {
                  setExpansions((prev) => ({ row: prev.col, col: prev.row }))
                  update({ row: state.col, col: state.row, rowTerms: state.colTerms, colTerms: state.rowTerms })
                }}
              >
                ⇄ Swap axes
              </LinkButton>
              <span className="inline-flex items-center gap-1.5">
                Color
                <Segmented
                  ariaLabel="Cell color"
                  options={[
                    { value: "count", label: "Count" },
                    { value: "residual", label: "Residual" },
                  ]}
                  value={state.color}
                  onChange={(color: HeatmapColor) => update({ color })}
                />
              </span>
              {excluded && (
                <Tag kind="warn">
                  Not filtered by {fieldLabel(state.row)}
                  {state.row !== state.col ? ` or ${fieldLabel(state.col)}` : ""}
                </Tag>
              )}
            </div>
            <span className="flex shrink-0 gap-1.5 font-mono text-fs-micro">
              <LinkButton mono tone="soft" onClick={exportTsv}>
                Matrix TSV
              </LinkButton>
              <LinkButton mono tone="soft" onClick={exportSvg}>
                SVG
              </LinkButton>
              <LinkButton mono tone="soft" onClick={exportPng}>
                PNG
              </LinkButton>
            </span>
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
            {state.color === "count" ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                0<span className="inline-block h-2.5 w-25 rounded-badge" style={{ background: gradient }} />
                {formatCount(max)} <span>{unit}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Swatch className="bg-under" /> r ≤ −4 <Swatch className="bg-under-soft" /> ≤ −2 <Swatch className="bg-brand-tint" /> ≥ 2 <Swatch className="bg-brand" /> ≥ 4
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block h-3.5 w-5.5 rounded-badge border-gap border-dashed border-critical-fg bg-surface" />
              Gap: 0 where 5 or more are expected
            </span>
            {state.color === "count" && (
              <>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-3.5 w-5.5 rounded-badge border border-dashed border-under bg-surface" />
                  Under-represented (r ≤ −2)
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-3.5 w-5.5 rounded-badge border border-dashed border-brand bg-surface" />
                  Over-represented (r ≥ 2)
                </span>
              </>
            )}
          </div>
        </CardHeader>
        <div className="max-h-matrix-max overflow-auto">
          <table className="min-w-full border-separate border-spacing-0.5 text-fs-label">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 bg-surface px-2.5 py-2 text-left align-bottom text-fs-micro font-semibold whitespace-nowrap text-ink-soft">
                  {fieldLabel(state.row)} ↓ &nbsp;·&nbsp; {fieldLabel(state.col)} →
                </th>
                {cols.map((col) => (
                  <th
                    key={col.value}
                    title={col.value}
                    className="sticky top-0 z-10 max-w-heat-head min-w-heat-cell bg-surface px-1 py-1.5 align-bottom text-fs-micro leading-snug font-medium text-balance"
                  >
                    {col.label}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-surface px-2 py-1.5 text-right align-bottom text-fs-micro font-semibold text-ink-soft">Row total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowSelected = condition.isSelected(row.clauses)
                return (
                  <tr key={row.value}>
                    <th
                      title={row.value}
                      className={cn("sticky left-0 z-10 bg-surface px-2.5 py-1 text-left text-fs-label whitespace-nowrap", rowSelected ? "font-semibold" : "font-medium")}
                    >
                      <span className="inline-block" style={{ width: depthOf("row")(row.value) * 12 }} />
                      {row.label}
                    </th>
                    {cols.map((col) => {
                      const cell = cellByKey.get(`${row.value}\t${col.value}`)
                      const style = cellStyle(cell)
                      const gap = cell?.classification === "gap"
                      const selected = rowSelected && condition.isSelected(col.clauses)
                      const classification = cell?.classification ?? null
                      const text = !cell ? "" : state.color === "residual" ? formatResidual(cell.residual) : cell.count === 0 ? (gap ? "0" : "·") : formatCount(cell.count)
                      const title = cell
                        ? `${row.label} × ${col.label}: ${formatCount(cell.count)} ${unit}` +
                          (cell.expected !== null ? `, expected ${cell.expected.toFixed(1)}, residual ${formatResidual(cell.residual)}` : "") +
                          (classification ? ` (${CLASS_LABEL[classification]})` : "")
                        : ""
                      const empty = !cell || cell.count === 0
                      const className = cn(
                        "flex h-8 w-full min-w-heat-cell items-center justify-center rounded-badge border px-1.5 font-mono text-fs-label",
                        gap && "border-gap border-dashed border-critical-fg font-semibold text-critical-fg",
                        !gap && classification === "under" && state.color === "count" && "border-dashed border-under",
                        !gap && classification === "over" && state.color === "count" && "border-dashed border-brand",
                        !gap && !classification && "border-transparent",
                        !gap && empty && "text-ink-soft",
                        selected && "outline-2 outline-selection",
                      )
                      const cellStyleProps = {
                        background: gap ? token("--color-surface") : style.background,
                        color: gap ? undefined : style.dark ? token("--color-surface") : undefined,
                      }
                      return (
                        <td key={col.value} className="p-0">
                          {empty ? (
                            <div title={title} className={className} style={cellStyleProps}>
                              {text}
                            </div>
                          ) : (
                            <Clickable
                              title={title}
                              aria-label={`${row.label} × ${col.label}: ${text}. Open in Samples`}
                              onClick={() => void openCell([...row.clauses, ...col.clauses])}
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
              <tr>
                <th className="sticky left-0 z-10 border-t border-border-soft bg-surface px-2.5 py-2 text-left text-fs-micro font-semibold text-ink-soft">Column total</th>
                {cols.map((col) => (
                  <td key={col.value} className="border-t border-border-soft p-1.5 text-center font-mono text-ink-soft">
                    {formatCount(col.count)}
                  </td>
                ))}
                <td className="border-t border-border-soft px-2.5 py-1.5 text-right font-mono font-medium text-ink-mid">{formatCount(data?.total ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CardFooter>
          <span className="text-fs-micro">
            A cell opens its records in Samples. Rows and columns overlap (multi-valued fields, child terms), so marginal totals are not sums
            of the cells and may exceed the {unit} total. Cells with fewer than 5 expected {unit} are not classified. r is the adjusted
            standardized residual.
          </span>
        </CardFooter>
      </Card>
    </div>
  )
}

const Swatch = ({ className }: { className: string }) => <span className={cn("inline-block h-3.5 w-5.5 rounded-badge", className)} />

export type { AxisSide } from "./axis-card"
