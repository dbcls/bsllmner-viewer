import { useRef } from "react"

import { type TrendParams, useDataset, useTrend } from "~/lib/api/queries"
import { token } from "~/lib/color"
import { downloadPng, downloadSvg, downloadTsv } from "~/lib/export"
import { formatCount } from "~/lib/format"
import { fieldLabel, unitLabel } from "~/lib/labels"
import { Card, LinkButton, Select, Tag } from "~/ui"

import { clausesOfField } from "../ast"
import type { WorkspaceState } from "../state"
import type { Condition } from "../use-condition"
import { trendFields } from "./field"
import { gridLines, PLOT, showYearLabel, xForIndex, yForValue, yMax } from "./scale"

/** x of the right-aligned count labels next to the grid lines, just left of the plot. */
const GRID_LABEL_X = 62
/** y of the year labels below the bottom axis line. */
const YEAR_LABEL_Y = 300

type TrendTabProps = {
  state: WorkspaceState
  condition: Condition
  field: string
  onTrendField: (field: string | null) => void
}

/** Counts per element and BioSample creation year, one line per term in the condition (or per top term). */
export const TrendTab = ({ state, condition, field, onTrendField }: TrendTabProps) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []

  const fieldClauses = clausesOfField(condition.ast, field)
  const elements = fieldClauses.length > 0
    ? fieldClauses.map((clause) => clause.value).filter((value): value is string => value !== undefined).join(",")
    : undefined
  const params: TrendParams = elements
    ? { field, q: state.q, unit: state.unit, selfExclusion: state.selfExclusion, elements, limit: 5 }
    : { field, q: state.q, unit: state.unit, selfExclusion: state.selfExclusion, limit: 5 }
  const trend = useTrend(params)
  const years = trend.data?.years ?? []
  const series = trend.data?.series ?? []
  const yearIndex = new Map(years.map((year, index) => [year, index]))
  const max = yMax(series.flatMap((s) => s.points.map((p) => p.count)))

  const warn = state.selfExclusion && (fieldClauses.length > 0 || clausesOfField(condition.ast, "date_created").length > 0)
  const title = fieldClauses.length > 0 ? "Terms in the condition" : `Top terms (${fieldLabel(field)})`
  const fieldOptions = trendFields(fields).map((f) => ({ value: f, label: fieldLabel(f) }))
  const seriesColors = [
    token("--color-brand"),
    token("--color-series-2"),
    token("--color-series-3"),
    token("--color-series-4"),
    token("--color-brand-light"),
  ]
  const colorOf = (index: number): string => seriesColors[index % seriesColors.length] ?? token("--color-brand")

  const exportTsv = () =>
    downloadTsv(
      "trend.tsv",
      ["term_id", "label", "year", "count"],
      series.flatMap((s) => s.points.map((point) => [s.value, s.label, point.year, point.count])),
    )
  const exportSvg = () => {
    if (svgRef.current) downloadSvg("trend.svg", svgRef.current)
  }
  const exportPng = () => {
    if (svgRef.current) void downloadPng("trend.png", svgRef.current)
  }

  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{title}</span>
          <span className="text-fs-label text-ink-soft">{unitLabel(state.unit)} per BioSample creation year</span>
          {warn && <Tag kind="warn">Each series ignores its own field and the year filter</Tag>}
          <span className="inline-flex items-center gap-1.5 text-fs-label text-ink-soft">
            Series field
            <Select size="sm" options={fieldOptions} value={field} onChange={onTrendField} aria-label="Series field" />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <LinkButton mono tone="soft" onClick={exportTsv}>TSV</LinkButton>
          <LinkButton mono tone="soft" onClick={exportSvg}>SVG</LinkButton>
          <LinkButton mono tone="soft" onClick={exportPng}>PNG</LinkButton>
        </div>
      </div>
      {series.length > 0 ? (
        <>
          <svg ref={svgRef} viewBox="0 0 960 320" className="mt-3 w-full max-w-chart-max font-mono">
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
              const linePoints = s.points
                .map((point) => `${xForIndex(yearIndex.get(point.year) ?? 0, years.length)},${yForValue(point.count, max)}`)
                .join(" ")
              return (
                <g key={s.value}>
                  <polyline points={linePoints} fill="none" stroke={color} strokeWidth={2} />
                  {s.points.map((point) => {
                    const x = xForIndex(yearIndex.get(point.year) ?? 0, years.length)
                    const y = yForValue(point.count, max)
                    const yearClause = point.clauses.find((clause) => clause.field === "date_created")
                    const selected = yearClause !== undefined && condition.isSelected([yearClause])
                    return (
                      <circle
                        key={point.year}
                        cx={x}
                        cy={y}
                        r={selected ? 6 : 4}
                        fill={selected ? token("--color-selection") : token("--color-surface")}
                        stroke={color}
                        strokeWidth={2}
                        className="cursor-pointer"
                        onClick={() => void condition.toggle(point.clauses)}
                      >
                        <title>{`${s.label} · ${point.year}: ${formatCount(point.count)} ${unitLabel(state.unit)}`}</title>
                      </circle>
                    )
                  })}
                </g>
              )
            })}
          </svg>
          <div className="mt-2 flex flex-wrap gap-3.5">
            {series.map((s, seriesIndex) => (
              <span key={s.value} className="inline-flex items-center gap-1.5 text-fs-micro">
                <svg width={14} height={3} aria-hidden="true">
                  <line x1={0} y1={1.5} x2={14} y2={1.5} stroke={colorOf(seriesIndex)} strokeWidth={3} />
                </svg>
                <span>{s.label}</span>
                <span className="font-mono text-ink-soft">{s.value}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 text-fs-label text-ink-soft">
            Click a point to add that term and year to the condition. Series are the terms in the condition; with no term selected, the top terms of the field are shown.
          </div>
        </>
      ) : (
        trend.data && <div className="py-10 text-center text-fs-body-sm text-ink-soft">No terms to plot for this condition.</div>
      )}
    </Card>
  )
}
