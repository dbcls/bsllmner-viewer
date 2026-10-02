import { useDataset, useDistribution, useTermChildren } from "~/lib/api/queries"
import type { Element, TermElement } from "~/lib/api/types"
import { downloadPngMarkup, downloadSvgMarkup, downloadTsv } from "~/lib/export"
import { formatCount } from "~/lib/format"
import { fieldLabel, ontologyLabel, unitLabel } from "~/lib/labels"
import { Card, Clickable, cn, LinkButton, Tag } from "~/ui"

import { clausesOfField } from "../ast"
import type { WorkspaceState } from "../state"
import type { Condition } from "../use-condition"
import { type BarDatum, barsSvg } from "./bars-svg"
import { StatusBar } from "./status-bar"

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
const EXTRA_DIMENSIONS = ["library_strategy", "organism_id", "date_created"]

type DistributionTabProps = {
  state: WorkspaceState
  condition: Condition
  onExpandedStatus: () => void
  onExpanded: (expanded: string[]) => void
}

/** One card per dimension: the top elements as bars, with status composition for annotation fields. */
export const DistributionTab = ({ state, condition, onExpandedStatus, onExpanded }: DistributionTabProps) => {
  const dataset = useDataset()
  const fields = dataset.data?.fields ?? []
  const names = new Set(fields.map((f) => f.name))
  const ordered = [...FIELD_ORDER.filter((f) => names.has(f)), ...fields.map((f) => f.name).filter((f) => !FIELD_ORDER.includes(f))]
  const ontologies = new Map(fields.map((f) => [f.name, f.ontologies.map(ontologyLabel).join(" / ")]))
  return (
    <div>
      <div className="mb-4">
        <Card padding="sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-fs-label text-ink-soft">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-5.5 rounded-badge bg-brand" />
              Exact match
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-5.5 rounded-badge bg-brand-light" />
              LLM selected
            </span>
            <span>Each card shows the terms assigned to the most BioSamples. Counts include child terms.</span>
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...ordered, ...EXTRA_DIMENSIONS].map((field) => (
          <DistributionCard
            key={field}
            field={field}
            isAnnotation={names.has(field)}
            ontology={ontologies.get(field) ?? extraOntology(field)}
            state={state}
            condition={condition}
            onExpandedStatus={onExpandedStatus}
            onExpanded={onExpanded}
          />
        ))}
      </div>
    </div>
  )
}

const extraOntology = (field: string): string => {
  if (field === "library_strategy") return "SRA"
  if (field === "organism_id") return "NCBI Taxonomy"
  return "BioSample"
}

type CardProps = {
  field: string
  isAnnotation: boolean
  ontology: string
  state: WorkspaceState
  condition: Condition
  onExpandedStatus: () => void
  onExpanded: (expanded: string[]) => void
}

const isTermElement = (element: Element | TermElement): element is TermElement => "hasChildren" in element

const DistributionCard = ({ field, isAnnotation, ontology, state, condition, onExpandedStatus, onExpanded }: CardProps) => {
  const distribution = useDistribution({
    field,
    q: state.q,
    unit: state.unit,
    selfExclusion: state.selfExclusion,
    limit: 10,
    expandedStatus: state.expandedStatus,
  })
  const ownCondition = clausesOfField(condition.ast, field).length > 0
  const data = distribution.data
  const unfiltered = data !== undefined && data.populationQ !== data.q
  const shown = data?.elements ?? []
  const elements = field === "date_created" ? [...shown].reverse() : shown
  const max = Math.max(1, ...elements.map((e) => e.count))
  const unit = unitLabel(state.unit)

  const collect = (): BarDatum[] =>
    elements.map((e) => ({
      label: e.label,
      count: e.count,
      exact: isTermElement(e) ? e.countExact : e.count,
      selected: isTermElement(e) ? e.countSelected : 0,
      depth: 0,
    }))
  const exportName = `${field}-distribution`
  const exportTsv = () =>
    downloadTsv(
      `${exportName}.tsv`,
      ["value", "label", unit.toLowerCase(), "exact_match", "llm_selected"],
      elements.map((e) => [e.value, e.label, e.count, isTermElement(e) ? e.countExact : "", isTermElement(e) ? e.countSelected : ""]),
    )
  const exportSvg = () => downloadSvgMarkup(`${exportName}.svg`, barsSvg(fieldLabel(field), unit, collect()))
  const exportPng = () => {
    const rows = collect()
    void downloadPngMarkup(`${exportName}.png`, barsSvg(fieldLabel(field), unit, rows), 480, 40 + rows.length * 30)
  }

  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold">{fieldLabel(field)}</span>
          <span className="ml-1 text-fs-micro text-ink-soft">{ontology}</span>
          {unfiltered && (
            <span className="ml-1.5">
              <Tag kind="warn">Not filtered by {fieldLabel(field)}</Tag>
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <LinkButton mono tone="soft" onClick={exportTsv}>
            TSV
          </LinkButton>
          <LinkButton mono tone="soft" onClick={exportSvg}>
            SVG
          </LinkButton>
          <LinkButton mono tone="soft" onClick={exportPng}>
            PNG
          </LinkButton>
        </div>
      </div>
      {isAnnotation && data?.status && <StatusBar status={data.status} expanded={state.expandedStatus} onToggleExpanded={onExpandedStatus} />}
      <div className={cn("flex-1", !isAnnotation && "mt-2")}>
        {elements.map((element) => (
          <ElementRows
            key={element.value}
            field={field}
            element={element}
            depth={0}
            max={max}
            isAnnotation={isAnnotation}
            ownCondition={ownCondition}
            state={state}
            condition={condition}
            onExpanded={onExpanded}
          />
        ))}
        {data && elements.length === 0 && <div className="py-3 text-fs-label text-ink-soft">No values in this population.</div>}
      </div>

    </Card>
  )
}

type ElementRowsProps = {
  field: string
  element: Element | TermElement
  depth: number
  max: number
  isAnnotation: boolean
  ownCondition: boolean
  state: WorkspaceState
  condition: Condition
  onExpanded: (expanded: string[]) => void
}

const ElementRows = ({ field, element, depth, max, isAnnotation, ownCondition, state, condition, onExpanded }: ElementRowsProps) => {
  const key = `${field}:${element.value}`
  const expandable = isTermElement(element) && element.hasChildren
  const expanded = expandable && state.expanded.includes(key)
  const selected = condition.isSelected(element.clauses)
  const exact = isTermElement(element) ? element.countExact : element.count
  const selectedCount = isTermElement(element) ? element.countSelected : 0
  const exactPct = isAnnotation ? (exact + selectedCount > 0 ? (exact / (exact + selectedCount)) * 100 : 100) : 100
  const dimmed = ownCondition && !selected
  const toggleExpanded = () => onExpanded(expanded ? state.expanded.filter((e) => e !== key) : [...state.expanded, key])
  return (
    <>
      <div className="flex items-center gap-2 rounded-tag px-0.5 py-0.5 hover:bg-brand-soft" style={{ paddingLeft: depth * 14 }}>
        <Clickable
          onClick={() => void condition.toggle(element.clauses)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          aria-pressed={selected}
        >
          <span className="min-w-0 flex-1">
            <span className={cn("flex min-w-0 items-center gap-1 text-fs-body-sm", selected && "font-semibold")}>
              {expandable && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={expanded ? "Collapse child terms" : "Expand child terms"}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleExpanded()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      event.stopPropagation()
                      toggleExpanded()
                    }
                  }}
                  className="w-3.5 shrink-0 text-fs-micro text-ink-soft"
                >
                  {expanded ? "▾" : "▸"}
                </span>
              )}
              <span className="truncate">{element.label}</span>
              {selected && <span className="shrink-0 text-fs-micro font-semibold text-brand">✓ in condition</span>}
            </span>
            <span className={cn("mt-0.5 block h-2 overflow-hidden rounded-badge bg-brand-soft", selected && "ring-2 ring-selection")}>
              <span className="flex h-full overflow-hidden rounded-badge" style={{ width: `${(element.count / max) * 100}%` }}>
                <span className={cn("h-full", dimmed ? "bg-brand-tint" : "bg-brand")} style={{ width: `${exactPct}%` }} title="Exact match" />
                <span className={cn("h-full flex-1", dimmed ? "bg-brand-faint" : isAnnotation ? "bg-brand-light" : "bg-brand")} title="LLM selected" />
              </span>
            </span>
          </span>
          <span className="w-17 shrink-0 text-right font-mono text-fs-label text-ink-mid">{formatCount(element.count)}</span>
        </Clickable>
      </div>
      {expanded && (
        <ChildRows
          field={field}
          termId={element.value}
          depth={depth + 1}
          max={max}
          isAnnotation={isAnnotation}
          ownCondition={ownCondition}
          state={state}
          condition={condition}
          onExpanded={onExpanded}
        />
      )}
    </>
  )
}

type ChildRowsProps = Omit<ElementRowsProps, "element"> & { termId: string }

const ChildRows = ({ field, termId, ...rest }: ChildRowsProps) => {
  const children = useTermChildren({
    field,
    termId,
    q: rest.state.q,
    unit: rest.state.unit,
    selfExclusion: rest.state.selfExclusion,
  })
  return (
    <>
      {(children.data?.children ?? []).map((child) => (
        <ElementRows key={child.value} field={field} element={child} {...rest} />
      ))}
    </>
  )
}
