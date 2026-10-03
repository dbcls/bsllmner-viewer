import { loadFailureProps } from "~/lib/api/client"
import { queryFailed, useDataset, useDistribution } from "~/lib/api/queries"
import type { DatasetResponse, Element, TermElement, Unit } from "~/lib/api/types"
import { downloadPngMarkup, downloadSvgMarkup, downloadTsv, FIGURE_SAVE_FAILED } from "~/lib/export"
import { figureFileName } from "~/lib/figure-style"
import { formatCount, formatPercent } from "~/lib/format"
import { fieldLabel, ontologyName, unitLabel } from "~/lib/labels"
import { Card, Clickable, cn, EmptyNotice, ErrorNotice,Skeleton } from "~/ui"

import { clausesOfField } from "../ast"
import { expectedElements } from "../expected-elements"
import { FigureExport } from "../figure-export"
import type { WorkspaceState } from "../state"
import { TermIdHover } from "../term-id-hover"
import type { Condition } from "../use-condition"
import { ViewControls } from "../view-controls"
import { DISTRIBUTION_LIMIT, distributionFields, distributionParams } from "../view-requests"
import { type BarDatum, barsSvg, barsSvgSize } from "./bars-svg"
import { DISTRIBUTION_HEADER, distributionRows, WITHOUT_TERM_LABEL } from "./table"

/** The annotation cards drawn as skeletons before the description of the dataset arrives, on the first visit only. */
const FIELD_CARDS = 6

type DistributionTabProps = {
  state: WorkspaceState
  condition: Condition
  onUnit: (unit: Unit) => void
  onTermIds: () => void
  onAlert: (message: string) => void
}

/** One card per annotation field: the top terms as bars, and the part of the population without a term of the field. */
export const DistributionTab = ({ state, condition, onUnit, onTermIds, onAlert }: DistributionTabProps) => {
  const dataset = useDataset()
  const fields = dataset.data?.fields ?? []
  const ordered = distributionFields(fields.map((f) => f.name))
  const datasetFailed = queryFailed(dataset)
  const known = dataset.data?.ontologies ?? []
  const ontologies = new Map(fields.map((f) => [f.name, f.ontologies.map((prefix) => ontologyName(prefix, known)).join(" / ")]))
  return (
    <div>
      <ViewControls
        unit={state.unit}
        onUnit={onUnit}
        termIds={state.termIds}
        onTermIds={onTermIds}
        help="Each card shows the terms assigned to the most BioSamples. Counts include descendant terms."
      />
      <div className="grid grid-cols-3 gap-4">
        {datasetFailed && (
          <div className="col-span-3">
            <ErrorNotice {...loadFailureProps(dataset.error, "load the dataset", () => void dataset.refetch(), "dataset, distribution")} />
          </div>
        )}
        {dataset.data === undefined && !datasetFailed &&
          Array.from({ length: FIELD_CARDS }, (_, index) => (
            <Card key={index} padding="sm">
              <Skeleton className="w-32" />
              <div className="mt-2">
                <SkeletonBars count={DISTRIBUTION_LIMIT} />
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
            onAlert={onAlert}
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
  onAlert: (message: string) => void
}

const DistributionCard = ({ field, ontology, dataset, state, condition, onAlert }: CardProps) => {
  const distribution = useDistribution(distributionParams(state, field))
  const ownCondition = clausesOfField(condition.selected, field).length > 0
  const data = distribution.data
  const elements = data?.elements ?? []
  const max = Math.max(1, ...elements.map((e) => e.count))
  const unit = unitLabel(state.unit)
  const failed = queryFailed(distribution)

  const collect = (): BarDatum[] =>
    elements.map((e) => ({
      label: e.label,
      ...(state.termIds ? { id: e.value } : {}),
      count: e.count,
    }))
  const name = (extension: "tsv" | "svg" | "png") => figureFileName("distribution", [field], state.unit, extension)
  const exportTsv = () => downloadTsv(name("tsv"), DISTRIBUTION_HEADER, distributionRows(elements, data?.withoutTerm, data?.total ?? 0))
  const withoutTerm = data?.withoutTerm == null ? null : { count: data.withoutTerm, total: data.total }
  const exportSvg = () => void downloadSvgMarkup(name("svg"), barsSvg(fieldLabel(field), unit, collect(), withoutTerm)).catch(() => onAlert(FIGURE_SAVE_FAILED))
  const exportPng = () => {
    const rows = collect()
    const { width, height } = barsSvgSize(rows, withoutTerm)
    void downloadPngMarkup(name("png"), barsSvg(fieldLabel(field), unit, rows, withoutTerm), width, height).catch(() => onAlert(FIGURE_SAVE_FAILED))
  }

  return (
    <Card padding="sm" busy={distribution.isPlaceholderData}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="inline font-semibold">{fieldLabel(field)}</h2>
          <span className="ml-1 text-fs-micro text-ink-soft">{ontology}</span>
        </div>
        <FigureExport figure={`${fieldLabel(field)} distribution`} disabled={data === undefined || failed || distribution.isPlaceholderData || elements.length === 0} onTsv={exportTsv} onSvg={exportSvg} onPng={exportPng} />
      </div>
      <div className="mt-2 flex-1">
        {failed && (
          <ErrorNotice {...loadFailureProps(distribution.error, `load the ${fieldLabel(field)} distribution`, () => void distribution.refetch(), `${fieldLabel(field)} distribution`)} />
        )}
        {data === undefined && !failed && <SkeletonBars count={expectedElements(field, dataset, DISTRIBUTION_LIMIT)} />}
        {elements.map((element) => (
          <ElementRow key={element.value} element={element} max={max} ownCondition={ownCondition} condition={condition} showId={state.termIds} />
        ))}
        {data && elements.length === 0 && <EmptyNotice>{data.total === 0 ? `No ${unit} match this condition.` : `No matching ${unit} have a term in this field.`}</EmptyNotice>}
        {data?.withoutTerm != null && <WithoutTermRow count={data.withoutTerm} total={data.total} />}
        {data === undefined && !failed && <SkeletonWithoutTerm />}
      </div>

    </Card>
  )
}

/**
 * The part of the population that the bars cannot count, because it has no term of the field. It is not a value of the
 * field, so it has no bar and does not change the condition.
 */
const WithoutTermRow = ({ count, total }: { count: number; total: number }) => (
  <div className={WITHOUT_TERM_ROW}>
    <span className="min-w-0 flex-1 truncate">{WITHOUT_TERM_LABEL}</span>
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
