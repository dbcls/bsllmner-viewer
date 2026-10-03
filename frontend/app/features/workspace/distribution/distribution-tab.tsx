import { useDataset, useDistribution } from "~/lib/api/queries"
import type { DatasetResponse, Element, TermElement, Unit } from "~/lib/api/types"
import { downloadPngMarkup, downloadSvgMarkup, downloadTsv } from "~/lib/export"
import { formatCount, formatPercent } from "~/lib/format"
import { fieldLabel, ontologyName, unitLabel } from "~/lib/labels"
import { Card, Clickable, cn, Skeleton } from "~/ui"

import { clausesOfField } from "../ast"
import { expectedElements } from "../expected-elements"
import { FigureExport } from "../figure-export"
import type { WorkspaceState } from "../state"
import { TermIdHover } from "../term-id-hover"
import type { Condition } from "../use-condition"
import { ViewControls } from "../view-controls"
import { type BarDatum, barsSvg } from "./bars-svg"

const FIELD_ORDER = [
  "disease",
  "cell_line",
  "tissue",
  "cell_type",
  "drug",
  "chip_antigen",
  "knockout_gene",
  "knockdown_gene",
  "overexpressed_gene",
]
const LIMIT = 10
/** The annotation cards drawn as skeletons before the description of the dataset arrives, on the first visit only. */
const FIELD_CARDS = 6

type DistributionTabProps = {
  state: WorkspaceState
  condition: Condition
  onUnit: (unit: Unit) => void
  onTermIds: () => void
}

/** One card per annotation field: the top terms as bars, and the part of the population without a term of the field. */
export const DistributionTab = ({ state, condition, onUnit, onTermIds }: DistributionTabProps) => {
  const dataset = useDataset()
  const fields = dataset.data?.fields ?? []
  const names = new Set(fields.map((f) => f.name))
  const ordered = [...FIELD_ORDER.filter((f) => names.has(f)), ...fields.map((f) => f.name).filter((f) => !FIELD_ORDER.includes(f))]
  const known = dataset.data?.ontologies ?? []
  const ontologies = new Map(fields.map((f) => [f.name, f.ontologies.map((prefix) => ontologyName(prefix, known)).join(" / ")]))
  return (
    <div>
      <ViewControls
        unit={state.unit}
        onUnit={onUnit}
        termIds={state.termIds}
        onTermIds={onTermIds}
        help="Each card shows the terms assigned to the most BioSamples. Counts include child terms."
      />
      <div className="grid grid-cols-3 gap-4">
        {dataset.data === undefined &&
          Array.from({ length: FIELD_CARDS }, (_, index) => (
            <Card key={index} padding="sm">
              <Skeleton className="w-32" />
              <div className="mt-2">
                <SkeletonBars count={LIMIT} />
              </div>
              <SkeletonWithoutTerm />
            </Card>
          ))}
        {ordered.map((field) => (
          <DistributionCard
            key={field}
            field={field}
            ontology={ontologies.get(field) ?? ""}
            dataset={dataset.data}
            state={state}
            condition={condition}
          />
        ))}
      </div>
    </div>
  )
}

type CardProps = {
  field: string
  ontology: string
  dataset: DatasetResponse | undefined
  state: WorkspaceState
  condition: Condition
}

const DistributionCard = ({ field, ontology, dataset, state, condition }: CardProps) => {
  const distribution = useDistribution({
    field,
    q: state.q,
    unit: state.unit,
    selfExclusion: true,
    limit: LIMIT,
  })
  const ownCondition = clausesOfField(condition.ast, field).length > 0
  const data = distribution.data
  const elements = data?.elements ?? []
  const max = Math.max(1, ...elements.map((e) => e.count))
  const unit = unitLabel(state.unit)

  const collect = (): BarDatum[] =>
    elements.map((e) => ({
      label: e.label,
      ...(state.termIds ? { id: e.value } : {}),
      count: e.count,
    }))
  const exportName = `${field}-distribution`
  const exportTsv = () =>
    downloadTsv(
      `${exportName}.tsv`,
      ["value", "label", unit.toLowerCase()],
      elements.map((e) => [e.value, e.label, e.count]),
    )
  const exportSvg = () => downloadSvgMarkup(`${exportName}.svg`, barsSvg(fieldLabel(field), unit, collect()))
  const exportPng = () => {
    const rows = collect()
    void downloadPngMarkup(`${exportName}.png`, barsSvg(fieldLabel(field), unit, rows), 480, 40 + rows.length * 30)
  }

  return (
    <Card padding="sm" busy={distribution.isPlaceholderData}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold">{fieldLabel(field)}</span>
          <span className="ml-1 text-fs-micro text-ink-soft">{ontology}</span>
        </div>
        <FigureExport figure={`${fieldLabel(field)} distribution`} onTsv={exportTsv} onSvg={exportSvg} onPng={exportPng} />
      </div>
      <div className="mt-2 flex-1">
        {data === undefined && <SkeletonBars count={expectedElements(field, dataset, LIMIT)} />}
        {elements.map((element) => (
          <ElementRow key={element.value} element={element} max={max} ownCondition={ownCondition} condition={condition} showId={state.termIds} />
        ))}
        {data && elements.length === 0 && <div className="py-3 text-fs-label text-ink-soft">No values in this population.</div>}
        {data?.withoutTerm != null && <WithoutTermRow field={field} count={data.withoutTerm} total={data.total} />}
        {data === undefined && <SkeletonWithoutTerm />}
      </div>

    </Card>
  )
}

/**
 * The part of the population that the bars cannot count, because it has no term of the field. It is not a value of the
 * field, so it has no bar and does not change the condition.
 */
const WithoutTermRow = ({ field, count, total }: { field: string; count: number; total: number }) => (
  <div className={WITHOUT_TERM_ROW}>
    <span className="min-w-0 flex-1 truncate">No {fieldLabel(field)} term</span>
    <span className="shrink-0 font-mono text-fs-label">
      {formatCount(count)} ({formatPercent(count, total)})
    </span>
  </div>
)

/** The row of the part without a term before it arrives, as tall as the row. */
const SkeletonWithoutTerm = () => (
  <div aria-hidden="true" className={WITHOUT_TERM_ROW}>
    <span className="flex-1">
      <Skeleton className="w-1/3" />
    </span>
    <span className="w-28 shrink-0 text-fs-label">
      <Skeleton className="w-full" />
    </span>
  </div>
)

const WITHOUT_TERM_ROW = "mt-1.5 flex items-center gap-2 border-t border-border-soft px-0.5 pt-3 text-fs-body-sm text-ink-soft"

/** Skeleton bars, each as tall as an element row: its label, its bar, and its count. */
const SkeletonBars = ({ count }: { count: number }) => (
  <div aria-busy="true">
    {Array.from({ length: count }, (_, index) => (
      <div key={index} className="flex items-center gap-2 px-0.5 py-0.5">
        <span className="min-w-0 flex-1">
          <span className="block text-fs-body-sm">
            <Skeleton className="w-1/2" />
          </span>
          <Skeleton kind="block" className="mt-0.5 h-2 w-full" />
        </span>
        <span className="flex w-17 shrink-0 justify-end text-fs-label">
          <Skeleton className="w-12" />
        </span>
      </div>
    ))}
  </div>
)

type ElementRowProps = {
  element: Element | TermElement
  max: number
  ownCondition: boolean
  condition: Condition
  /** The term ID follows the label. */
  showId: boolean
}

/** One element as a bar. Clicking it adds the element's clause to the condition, or removes it. */
const ElementRow = ({ element, max, ownCondition, condition, showId }: ElementRowProps) => {
  const selected = condition.isSelected(element.clauses)
  const dimmed = ownCondition && !selected
  return (
    <div className="flex items-center gap-2 rounded-tag px-0.5 py-0.5 hover:bg-brand-soft">
      <Clickable
        onClick={() => void condition.toggle(element.clauses)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        aria-pressed={selected}
      >
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-fs-body-sm", selected && "font-semibold")}>
            {element.label}
            {showId && (
              <>
                {" "}
                <TermIdHover termId={element.value} label={element.label} />
              </>
            )}
          </span>
          <span className={cn("mt-0.5 block h-2 overflow-hidden rounded-badge bg-brand-soft", selected && "ring-2 ring-selection")}>
            <span
              className={cn("block h-full rounded-badge", selected ? "bg-brand" : dimmed ? "bg-brand-tint" : "bg-brand-light")}
              style={{ width: `${(element.count / max) * 100}%` }}
            />
          </span>
        </span>
        <span className="w-17 shrink-0 text-right font-mono text-fs-label text-ink-mid">{formatCount(element.count)}</span>
      </Clickable>
    </div>
  )
}
