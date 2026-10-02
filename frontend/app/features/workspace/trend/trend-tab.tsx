import { useRef } from "react"
import { useNavigate } from "react-router"

import { useDataset, useTrend } from "~/lib/api/queries"
import type { Clause } from "~/lib/api/types"
import { token } from "~/lib/color"
import { downloadPng, downloadSvg, downloadTsv } from "~/lib/export"
import { formatCount } from "~/lib/format"
import { fieldLabel, organismLabel, unitLabel } from "~/lib/labels"
import { Card, InlineLabel, LinkButton, Select, Skeleton, Tag } from "~/ui"

import { workspaceSearch, type WorkspaceState } from "../state"
import type { Condition } from "../use-condition"
import { splitFieldOf, trendFields } from "./field"
import { gridLines, PLOT, showYearLabel, xForIndex, yForValue, yMax } from "./scale"

/** x of the right-aligned count labels next to the grid lines, just left of the plot. */
const GRID_LABEL_X = 62
/** y of the year labels below the bottom axis line. */
const YEAR_LABEL_Y = 300
const NO_SPLIT = ""

type TrendTabProps = {
  state: WorkspaceState
  condition: Condition
  onSplit: (field: string | null) => void
}

/** Counts of the condition per BioSample creation year, optionally split by the elements of one field. */
export const TrendTab = ({ state, condition, onSplit }: TrendTabProps) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const navigate = useNavigate()
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const split = splitFieldOf(state.trendField, fields)

  const trend = useTrend({
    ...(split ? { field: split } : {}),
    q: state.q,
    unit: state.unit,
    selfExclusion: state.selfExclusion,
    ...(state.trendTerms ? { elements: state.trendTerms.join(",") } : {}),
    limit: 5,
  })
  const data = trend.data
  const years = data?.years ?? []
  const total = data?.total ?? []
  const series = data?.series ?? []
  const max = yMax([...total.map((p) => p.count), ...series.flatMap((s) => s.points.map((p) => p.count))])
  const unit = unitLabel(state.unit)
  const totalLabel = state.q ? "Condition" : "All entries"

  const yearUnfiltered = data !== undefined && data.totalPopulationQ !== data.q
  const splitUnfiltered = data !== undefined && split !== null && data.populationQ !== data.totalPopulationQ
  const splitOptions = trendFields(fields).map((f) => ({ value: f, label: fieldLabel(f) }))
  const seriesColors = [
    token("--color-series-1"),
    token("--color-series-2"),
    token("--color-series-3"),
    token("--color-series-4"),
    token("--color-series-5"),
  ]
  const colorOf = (index: number): string => seriesColors[index % seriesColors.length] ?? token("--color-series-1")
  const totalColor = token("--color-brand")
  const seriesLabel = (value: string, label: string): string => (split === "organism_id" ? organismLabel(value, label) : label)

  /** Open the entry list narrowed to one element and year: the population of the series plus the point's clauses. */
  const openPoint = async (clauses: Clause[]) => {
    if (!data) return
    const q = await condition.narrowed(data.populationQ, clauses)
    await navigate(`/entries${workspaceSearch({ ...state, q, tab: "samples", page: 1 })}`)
  }

  const exportTsv = () =>
    downloadTsv(
      "trend.tsv",
      ["series", "label", "year", unit.toLowerCase()],
      [
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

  return (
    <Card padding="sm" busy={trend.isPlaceholderData}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{state.unit === "biosample" ? "Per BioSample creation year" : `${unit} per BioSample creation year`}</span>
          {yearUnfiltered && <Tag kind="warn">Not filtered by Year</Tag>}
          {splitUnfiltered && split && <Tag kind="warn">Split lines are not filtered by {fieldLabel(split)}</Tag>}
          <span className="inline-flex items-center gap-1.5 text-fs-label text-ink-soft">
            <InlineLabel>Split by</InlineLabel>
            <Select
              size="sm"
              placeholder="None"
              options={splitOptions}
              value={split ?? NO_SPLIT}
              onChange={(value) => onSplit(value === NO_SPLIT ? null : value)}
              aria-label="Split by"
            />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <LinkButton mono tone="soft" onClick={exportTsv}>TSV</LinkButton>
          <LinkButton mono tone="soft" onClick={exportSvg}>SVG</LinkButton>
          <LinkButton mono tone="soft" onClick={exportPng}>PNG</LinkButton>
        </div>
      </div>
      {years.length > 0 ? (
        <>
          <svg ref={svgRef} viewBox="0 0 960 320" className="mt-3 w-full max-w-chart-max font-mono" role="img" aria-label={`${unit} per year`}>
            {gridLines(max).map((line) => (
              <g key={line.value}>
                <line x1={PLOT.left} x2={PLOT.right} y1={line.y} y2={line.y} stroke={token("--color-grid")} />
                <text
                  x={GRID_LABEL_X}
                  y={line.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="text-fs-micro"
                  fill={token("--color-ink-soft")}
                >
                  {formatCount(line.value)}
                </text>
              </g>
            ))}
            <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} stroke={token("--color-border-soft")} />
            {years.map((year, index) =>
              showYearLabel(index, years.length) ? (
                <text
                  key={year}
                  x={xForIndex(index, years.length)}
                  y={YEAR_LABEL_Y}
                  textAnchor="middle"
                  className="text-fs-micro"
                  fill={token("--color-ink-soft")}
                >
                  {year}
                </text>
              ) : null,
            )}
            {series.map((s, seriesIndex) => {
              const color = colorOf(seriesIndex)
              const points = s.points.map((point, index) => ({ point, x: xForIndex(index, years.length), y: yForValue(point.count, max) }))
              return (
                <g key={s.value} data-series={s.value}>
                  <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} fill="none" stroke={color} strokeWidth={2} />
                  {points.map(({ point, x, y }) => (
                    <circle
                      key={point.year}
                      cx={x}
                      cy={y}
                      r={4}
                      fill={token("--color-surface")}
                      stroke={color}
                      strokeWidth={2}
                      className={point.count > 0 ? "cursor-pointer" : undefined}
                      onClick={point.count > 0 ? () => void openPoint(point.clauses) : undefined}
                    >
                      <title>{`${seriesLabel(s.value, s.label)} · ${point.year}: ${formatCount(point.count)} ${unit}`}</title>
                    </circle>
                  ))}
                </g>
              )
            })}
            <g data-series="condition">
              <polyline
                points={total.map((point, index) => `${xForIndex(index, years.length)},${yForValue(point.count, max)}`).join(" ")}
                fill="none"
                stroke={totalColor}
                strokeWidth={3}
              />
              {total.map((point, index) => {
                const selected = condition.isSelected(point.clauses)
                return (
                  <circle
                    key={point.year}
                    cx={xForIndex(index, years.length)}
                    cy={yForValue(point.count, max)}
                    r={selected ? 6.5 : 4.5}
                    fill={selected ? token("--color-selection") : token("--color-surface")}
                    stroke={totalColor}
                    strokeWidth={3}
                    className="cursor-pointer"
                    onClick={() => void condition.toggle(point.clauses)}
                  >
                    <title>{`${totalLabel} · ${point.year}: ${formatCount(point.count)} ${unit}`}</title>
                  </circle>
                )
              })}
            </g>
          </svg>
          <div className="mt-2 flex flex-wrap gap-3.5">
            <LegendItem color={totalColor} width={3} label={totalLabel} strong />
            {series.map((s, seriesIndex) => (
              <LegendItem
                key={s.value}
                color={colorOf(seriesIndex)}
                width={2}
                label={seriesLabel(s.value, s.label)}
                {...(split !== "library_strategy" && split !== "organism_id" ? { id: s.value } : {})}
                {...(condition.isSelected(s.clauses) ? { note: "✓ in condition" } : {})}
              />
            ))}
          </div>
        </>
      ) : data ? (
        <div className="py-10 text-center text-fs-body-sm text-ink-soft">No entries with a creation year match this condition.</div>
      ) : (
        <SkeletonChart />
      )}
    </Card>
  )
}

/** The chart before the first trend of a condition arrives: the plot area at its size, and one line of legend. */
const SkeletonChart = () => (
  <div aria-busy="true">
    <svg viewBox="0 0 960 320" className="mt-3 w-full max-w-chart-max animate-pulse" aria-hidden="true">
      <rect x={PLOT.left} y={PLOT.top} width={PLOT.right - PLOT.left} height={PLOT.bottom - PLOT.top} rx={4} fill={token("--color-skeleton")} />
    </svg>
    <div className="mt-2 text-fs-label">
      <Skeleton className="w-28" />
    </div>
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
  <span className="inline-flex items-center gap-1.5 text-fs-label">
    <svg width={16} height={4} aria-hidden="true">
      <line x1={0} y1={2} x2={16} y2={2} stroke={color} strokeWidth={width + 1} />
    </svg>
    <span className={strong ? "font-semibold" : undefined}>{label}</span>
    {id && <span className="font-mono text-fs-micro text-ink-soft">{id}</span>}
    {note && <span className="text-fs-micro font-semibold text-brand">{note}</span>}
  </span>
)
