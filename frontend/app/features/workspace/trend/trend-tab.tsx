import { type KeyboardEvent, useRef, useState } from "react"

import { useDataset, useTrend } from "~/lib/api/queries"
import type { Clause, TermHit, TrendSeries } from "~/lib/api/types"
import { token } from "~/lib/color"
import { downloadPng, downloadSvg, downloadTsv } from "~/lib/export"
import { formatCount } from "~/lib/format"
import { fieldLabel, organismLabel, unitLabel } from "~/lib/labels"
import { busyClass, Card, CardHeader, cn, InlineLabel, Select, Skeleton, Toggle } from "~/ui"

import { AxisControls } from "../axis/axis-controls"
import { resolvePasted } from "../axis/axis-terms"
import { AxisTermsDialog } from "../axis/axis-terms-dialog"
import { findTermId } from "../axis/find-term"
import { expectedElements } from "../expected-elements"
import { FigureExport } from "../figure-export"
import type { Patch, WorkspaceState } from "../state"
import { TermIdHover } from "../term-id-hover"
import type { Condition } from "../use-condition"
import { ViewControls } from "../view-controls"
import { lineFieldOf, trendFields } from "./field"
import { gridLines, PLOT, showYearLabel, xForIndex, yForValue, yMax } from "./scale"
import { yearChoices } from "./years"

/** x of the right-aligned count labels next to the grid lines, just left of the plot. */
const GRID_LABEL_X = 62
/** y of the year labels below the bottom axis line. */
const YEAR_LABEL_Y = 300
/** Space between a point and the data label above it. */
const DATA_LABEL_GAP = 5

const SERIES_COLORS = ["--color-series-1", "--color-series-2", "--color-series-3", "--color-series-4", "--color-series-5"]
/** The number of lines of the elements: the top elements when the user chose none, and the most that the user can choose, one per color. */
const LIMIT = SERIES_COLORS.length

type TrendTabProps = {
  state: WorkspaceState
  condition: Condition
  update: (patch: Patch) => void
  onAlert: (message: string) => void
}

type TrendPoint = TrendSeries["points"][number]

/** One drawn point of a line, with its place on the plot. */
type Placed = { point: TrendPoint; x: number; y: number; r: number }

/** Counts per BioSample publication year: the condition, and one line per element of one dimension. */
export const TrendTab = ({ state, condition, update, onAlert }: TrendTabProps) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const split = lineFieldOf(state.trendField, dataset.data ? fields : null)
  const dimensions = trendFields(fields).map((f) => ({ value: f, label: fieldLabel(f) }))

  const trend = useTrend({
    field: split,
    q: state.q,
    unit: state.unit,
    selfExclusion: true,
    ...(state.trendTerms ? { elements: state.trendTerms.join(",") } : {}),
    limit: LIMIT,
    ...(state.trendFrom !== null ? { yearFrom: state.trendFrom } : {}),
    ...(state.trendTo !== null ? { yearTo: state.trendTo } : {}),
  })
  const data = trend.data
  const years = data?.years ?? []
  const series = data?.series ?? []
  // Without a condition, the condition is the whole dataset, whose line is All entries.
  const drawTotal = state.q !== null && state.trendCondition
  const total = drawTotal ? (data?.total ?? []) : []
  const all = state.trendAll ? (data?.allEntries ?? []) : []
  const max = yMax([...all, ...total, ...series.flatMap((s) => s.points)].map((p) => p.count))
  const unit = unitLabel(state.unit)
  const totalLabel = "Condition"
  const allLabel = "All entries"

  const colorOf = (index: number): string => token(SERIES_COLORS[index % SERIES_COLORS.length] ?? "--color-series-1")
  const totalColor = token("--color-brand")
  const allColor = token("--color-ink-soft")
  const seriesLabel = (value: string, label: string): string => (split === "organism_id" ? organismLabel(value, label) : label)
  const pointName = (line: string, point: TrendPoint) => `${line}, ${point.year}: ${formatCount(point.count)} ${unit}`

  /**
   * Narrow the condition to one element and year: the population of the series plus the point's clauses. The view
   * stays, and selecting the point again widens the condition back to the population of the series.
   */
  const narrowPoint = (clauses: Clause[]) => {
    if (data) void condition.toggleNarrow(data.populationQ, clauses)
  }
  const onKey = (action: () => void) => (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    action()
  }

  const values = series.map((s) => s.value)
  const setTerms = (next: string[] | null) => update({ trendTerms: next })
  const pick = (hit: TermHit) => {
    if (values.includes(hit.termId)) setTerms(values.filter((v) => v !== hit.termId))
    else if (values.length >= LIMIT) onAlert(`A trend shows up to ${LIMIT} terms`)
    else setTerms([...values, hit.termId])
  }
  /** Makes the first pasted entries, up to the most lines a trend shows, the terms of the lines. */
  const replace = async (entries: string[]) => {
    const unique = await resolvePasted(entries, fields.includes(split), (label) => findTermId(split, label))
    if (unique.length === 0) {
      onAlert("No terms recognised")
      return
    }
    setTerms(unique.slice(0, LIMIT))
    onAlert(unique.length > LIMIT ? `The first ${LIMIT} of ${unique.length} terms are shown` : `${unique.length} of ${entries.length} terms recognised`)
  }
  const changeDimension = (dimension: string) => update({ trendField: dimension, trendTerms: null })

  const exportTsv = () =>
    downloadTsv(
      "trend.tsv",
      ["series", "label", "year", unit.toLowerCase()],
      [
        ...all.map((point) => ["all", allLabel, point.year, point.count]),
        ...total.map((point) => ["condition", totalLabel, point.year, point.count]),
        ...series.flatMap((s) => s.points.map((point) => [s.value, seriesLabel(s.value, s.label), point.year, point.count])),
      ],
    )
  const exportSvg = () => {
    if (svgRef.current) downloadSvg("trend.svg", svgRef.current)
  }
  const exportPng = () => {
    if (svgRef.current) void downloadPng("trend.png", svgRef.current)
  }

  const place = (points: TrendPoint[], radius: (point: TrendPoint) => number): Placed[] =>
    points.map((point, index) => ({ point, x: xForIndex(index, years.length), y: yForValue(point.count, max), r: radius(point) }))
  const seriesPlaces = series.map((s) => place(s.points, (point) => (point.count > 0 && condition.isSelected(point.clauses) ? 6 : 4)))
  const totalPlaces = place(total, (point) => (condition.isSelected(point.clauses) ? 6.5 : 4.5))
  const allPlaces = place(all, () => 3.5)

  return (
    <div>
      <ViewControls
        unit={state.unit}
        onUnit={(next) => update({ unit: next })}
        termIds={state.termIds}
        onTermIds={() => update({ termIds: !state.termIds })}
        controls={
          <>
            <Toggle label={allLabel} checked={state.trendAll} onChange={() => update({ trendAll: !state.trendAll })} />
            <Toggle label={totalLabel} checked={drawTotal} disabled={state.q === null} onChange={() => update({ trendCondition: !state.trendCondition })} />
            <Toggle label="Data labels" checked={state.trendLabels} onChange={() => update({ trendLabels: !state.trendLabels })} />
          </>
        }
      >
        <div
          aria-busy={trend.isPlaceholderData || undefined}
          className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 text-fs-label text-ink-soft", busyClass(trend.isPlaceholderData))}
        >
          <AxisControls
            name="Lines"
            selectLabel="Line dimension"
            dimension={split}
            dimensions={dimensions}
            elements={series}
            pending={data === undefined ? expectedElements(split, dataset.data, LIMIT, state.trendTerms) : null}
            onDimension={changeDimension}
            onOpenTerms={() => setTermsOpen(true)}
          />
          <YearControls
            first={data ? data.firstYear : undefined}
            last={data ? data.lastYear : undefined}
            from={state.trendFrom}
            to={state.trendTo}
            onFrom={(year) => update({ trendFrom: year })}
            onTo={(year) => update({ trendTo: year })}
          />
        </div>
      </ViewControls>
      <AxisTermsDialog
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
        title="Line terms"
        dimension={split}
        dimensions={dimensions}
        fields={fields}
        elements={series}
        pending={null}
        explicit={state.trendTerms !== null}
        limit={LIMIT}
        q={state.q}
        selectedNote="✓ in trend"
        onDimension={changeDimension}
        onPick={pick}
        onRemove={(value) => setTerms(values.filter((v) => v !== value))}
        onReset={() => setTerms(null)}
        onReplace={(entries) => void replace(entries)}
      />
      <Card padding="none" flush busy={trend.isPlaceholderData}>
        <CardHeader>
          {/* The legend wraps to more lines when the lines are many, and Export stays at the top right. */}
          <div className="flex w-full items-start justify-between gap-x-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3.5 gap-y-1">
              {data === undefined ? (
                <Skeleton className="w-28" />
              ) : (
                <>
                  {state.trendAll && <LegendItem color={allColor} width={2} label={allLabel} />}
                  {drawTotal && <LegendItem color={totalColor} width={3} label={totalLabel} strong />}
                  {series.map((s, seriesIndex) => (
                    <LegendItem
                      key={s.value}
                      color={colorOf(seriesIndex)}
                      width={2}
                      label={seriesLabel(s.value, s.label)}
                      {...(state.termIds && fields.includes(split) ? { id: s.value } : {})}
                      {...(condition.isSelected(s.clauses) ? { note: "✓ in condition" } : {})}
                    />
                  ))}
                </>
              )}
            </div>
            <FigureExport figure="trend" onTsv={exportTsv} onSvg={exportSvg} onPng={exportPng} />
          </div>
        </CardHeader>
        <div className="px-4 pt-3 pb-4">
          {years.length > 0 ? (
            <svg ref={svgRef} viewBox="0 0 960 320" className="w-full max-w-chart-max font-mono" role="img" aria-label={`${unit} per year`}>
              {gridLines(max).map((line) => (
                <g key={line.value}>
                  <line x1={PLOT.left} x2={PLOT.right} y1={line.y} y2={line.y} stroke={token("--color-grid")} />
                  <text x={GRID_LABEL_X} y={line.y} textAnchor="end" dominantBaseline="middle" className="text-fs-micro" fill={token("--color-ink-soft")}>
                    {formatCount(line.value)}
                  </text>
                </g>
              ))}
              <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} stroke={token("--color-border-soft")} />
              {years.map((year, index) =>
                showYearLabel(index, years.length) ? (
                  <text key={year} x={xForIndex(index, years.length)} y={YEAR_LABEL_Y} textAnchor="middle" className="text-fs-micro" fill={token("--color-ink-soft")}>
                    {year}
                  </text>
                ) : null,
              )}
              {series.map((s, seriesIndex) => {
                const color = colorOf(seriesIndex)
                const placed = seriesPlaces[seriesIndex] ?? []
                const label = seriesLabel(s.value, s.label)
                return (
                  <g key={s.value} data-series={s.value}>
                    <polyline points={placed.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke={color} strokeWidth={2} />
                    {placed.map(({ point, x, y, r }) => {
                      if (point.count === 0) {
                        return <circle key={point.year} cx={x} cy={y} r={r} fill={token("--color-surface")} stroke={color} strokeWidth={2} role="img" aria-label={pointName(label, point)} />
                      }
                      const selected = condition.isSelected(point.clauses)
                      return (
                        <circle
                          key={point.year}
                          cx={x}
                          cy={y}
                          r={r}
                          fill={selected ? token("--color-selection") : token("--color-surface")}
                          stroke={color}
                          strokeWidth={2}
                          className="cursor-pointer"
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          aria-label={`${pointName(label, point)}. Narrow the condition to this point`}
                          onClick={() => narrowPoint(point.clauses)}
                          onKeyDown={onKey(() => narrowPoint(point.clauses))}
                        />
                      )
                    })}
                  </g>
                )
              })}
              {/* The line of the whole dataset is a reference to compare with, so its points do not change the condition. */}
              {state.trendAll && (
                <g data-series="all">
                  <polyline points={allPlaces.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke={allColor} strokeWidth={2} />
                  {allPlaces.map(({ point, x, y, r }) => (
                    <circle key={point.year} cx={x} cy={y} r={r} fill={token("--color-surface")} stroke={allColor} strokeWidth={2} role="img" aria-label={pointName(allLabel, point)} />
                  ))}
                </g>
              )}
              {drawTotal && (
                <g data-series="condition">
                  <polyline points={totalPlaces.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke={totalColor} strokeWidth={3} />
                  {totalPlaces.map(({ point, x, y, r }) => {
                    const selected = condition.isSelected(point.clauses)
                    return (
                      <circle
                        key={point.year}
                        cx={x}
                        cy={y}
                        r={r}
                        fill={selected ? token("--color-selection") : token("--color-surface")}
                        stroke={totalColor}
                        strokeWidth={3}
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected}
                        aria-label={`${pointName(totalLabel, point)}. Toggle this year in the condition`}
                        onClick={() => void condition.toggle(point.clauses)}
                        onKeyDown={onKey(() => void condition.toggle(point.clauses))}
                      />
                    )
                  })}
                </g>
              )}
              {/*
               * The labels are drawn over every line, with a halo of the background. A point on the 0 line has no label: the
               * line says its count, and the zeros of several lines would print over one another. The label of the last
               * year ends at its point, so that it stays inside the figure.
               */}
              {state.trendLabels && (
                <g data-labels="" aria-hidden="true">
                  {[...series.map((s, seriesIndex) => ({ key: s.value, color: colorOf(seriesIndex), placed: seriesPlaces[seriesIndex] ?? [] })), { key: "all", color: allColor, placed: allPlaces }, { key: "condition", color: totalColor, placed: totalPlaces }].map(
                    ({ key, color, placed }) =>
                      placed.filter(({ point }) => point.count > 0).map(({ point, x, y, r }) => (
                        <text
                          key={`${key}:${point.year}`}
                          x={point.year === years[years.length - 1] && years.length > 1 ? x + r : x}
                          y={y - r - DATA_LABEL_GAP}
                          textAnchor={point.year === years[years.length - 1] && years.length > 1 ? "end" : "middle"}
                          className="text-fs-micro"
                          fill={color}
                          stroke={token("--color-surface")}
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {formatCount(point.count)}
                        </text>
                      )),
                  )}
                </g>
              )}
            </svg>
          ) : data ? (
            <div className="py-10 text-center text-fs-body-sm text-ink-soft">
              {data.firstYear === null ? "No entries with a publication year match this condition." : "No entries match this condition in the chosen years."}
            </div>
          ) : (
            <SkeletonChart />
          )}
        </div>
      </Card>
    </div>
  )
}

type YearControlsProps = {
  /** The first and the last year with a match: undefined while they are on their way, null when nothing matches. */
  first: number | null | undefined
  last: number | null | undefined
  from: number | null
  to: number | null
  onFrom: (year: number | null) => void
  onTo: (year: number | null) => void
}

/**
 * The years that the trend shows, from one year to another. Choosing the first or the last year with a match takes the
 * limit off, so that the trend follows the years of the next condition.
 */
const YearControls = ({ first, last, from, to, onFrom, onTo }: YearControlsProps) => {
  if (first === null || last === null) return null
  const known = first !== undefined && last !== undefined
  const choices = known ? yearChoices(first, last, from, to) : null
  const options = (list: number[]) => list.map((year) => ({ value: String(year), label: String(year) }))
  return (
    <span role="group" aria-label="Years" className="inline-flex items-center gap-1.5">
      <InlineLabel>Years</InlineLabel>
      {choices && known ? (
        <>
          <Select size="sm" options={options(choices.from)} value={String(from ?? first)} onChange={(value) => onFrom(Number(value) === first ? null : Number(value))} aria-label="First year" />
          to
          <Select size="sm" options={options(choices.to)} value={String(to ?? last)} onChange={(value) => onTo(Number(value) === last ? null : Number(value))} aria-label="Last year" />
        </>
      ) : (
        <>
          <Skeleton kind="block" className="h-box-sm w-16" />
          to
          <Skeleton kind="block" className="h-box-sm w-16" />
        </>
      )}
    </span>
  )
}

/** The chart before the first trend of a condition arrives: the plot area at its size. */
const SkeletonChart = () => (
  <div aria-busy="true">
    <svg viewBox="0 0 960 320" className="w-full max-w-chart-max animate-pulse" aria-hidden="true">
      <rect x={PLOT.left} y={PLOT.top} width={PLOT.right - PLOT.left} height={PLOT.bottom - PLOT.top} rx={4} fill={token("--color-skeleton")} />
    </svg>
  </div>
)

type LegendItemProps = {
  color: string
  width: number
  label: string
  id?: string
  note?: string
  strong?: boolean
}

const LegendItem = ({ color, width, label, id, note, strong }: LegendItemProps) => (
  <span className="inline-flex items-center gap-1.5 text-fs-label text-ink">
    <svg width={16} height={4} aria-hidden="true">
      <line x1={0} y1={2} x2={16} y2={2} stroke={color} strokeWidth={width + 1} />
    </svg>
    <span className={strong ? "font-semibold" : undefined}>{label}</span>
    {id && <TermIdHover termId={id} label={label} />}
    {note && <span className="text-fs-micro font-semibold text-brand">{note}</span>}
  </span>
)
