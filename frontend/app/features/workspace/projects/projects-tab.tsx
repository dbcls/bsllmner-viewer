import type { ReactNode } from "react"

import { useDataset, useProjects } from "~/lib/api/queries"
import type { Composition, Project, ProjectSort } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel } from "~/lib/labels"
import { TABLE_PER_PAGE } from "~/lib/workspace-state"
import { Card, CardFooter, CardHeader, cn, Pager, SortChooser, type SortDirection, type SortKey, Tag } from "~/ui"

import { leaves } from "../ast"
import type { WorkspaceState } from "../state"
import type { Condition } from "../use-condition"
import { useTableTop } from "../use-table-top"
import { compositionFields, compositionSegments, compositionSummary } from "./composition"

type ProjectSortKey = "biosampleCount" | "experimentCount" | "identifier"

const SORT_KEYS: (SortKey & { value: ProjectSortKey })[] = [
  { value: "biosampleCount", label: "BioSamples", direction: "desc" },
  { value: "experimentCount", label: "SRA Experiments", direction: "desc" },
  { value: "identifier", label: "Accession", direction: "asc" },
]

const projectSort = (key: string, direction: SortDirection): ProjectSort =>
  `${SORT_KEYS.find((option) => option.value === key)?.value ?? "biosampleCount"}:${direction}`

const SEGMENT_COLOR: Record<string, string> = {
  term: "bg-brand",
  other: "bg-brand-light",
  unmapped: "bg-unmapped-light",
  no_value: "bg-border-soft",
}

const LEGEND: { color: string; label: string }[] = [
  { color: "bg-brand", label: "most frequent term" },
  { color: "bg-brand-light", label: "other terms" },
  { color: "bg-unmapped-light", label: "unmapped" },
  { color: "bg-border-soft", label: "no value" },
]

type ProjectsTabProps = {
  state: WorkspaceState
  condition: Condition
  onPage: (page: number) => void
  onSort: (sort: ProjectSort) => void
}

/**
 * The BioProjects of the entries that match the full condition, with a composition summary of up to 3 annotation fields
 * per project.
 */
export const ProjectsTab = ({ state, condition, onPage, onSort }: ProjectsTabProps) => {
  const table = useTableTop(onPage)
  const dataset = useDataset()
  const annotationFields = new Set((dataset.data?.fields ?? []).map((field) => field.name))
  const requested = compositionFields(leaves(condition.ast).map((leaf) => leaf.field), annotationFields)
  const projects = useProjects({
    q: state.q,
    selfExclusion: false,
    sort: state.sort,
    page: state.page,
    perPage: TABLE_PER_PAGE,
    compositionFields: requested.join(","),
  })
  const fields = projects.data?.compositionFields ?? requested
  const [sortKey = "biosampleCount", sortDirection = "desc"] = state.sort.split(":") as [ProjectSortKey, SortDirection]
  const total = projects.data?.pagination.total

  return (
    <Card ref={table.ref} padding="none" flush>
      <CardHeader>
        <div className="flex min-w-0 grow basis-80 flex-col gap-1 text-fs-micro">
          <span>Term composition shows how consistently the samples of a project were annotated. A thin slice may be a mapping error.</span>
          <span>
            Click a row to restrict the condition to that project. Composition:
            {LEGEND.map((item, index) => (
              <span key={item.label} className="ml-1.5 inline-flex items-center gap-1">
                <span className={cn("inline-block h-2 w-2 rounded-badge", item.color)} />
                {item.label}
                {index < LEGEND.length - 1 ? " ·" : "."}
              </span>
            ))}
          </span>
        </div>
        <SortChooser keys={SORT_KEYS} value={sortKey} direction={sortDirection} onChange={(key, direction) => onSort(projectSort(key, direction))} />
        <div className="ml-auto">
          <Pager page={state.page} perPage={TABLE_PER_PAGE} total={total} onChange={onPage} />
        </div>
      </CardHeader>
      <div className="overflow-auto">
        <table className="w-full min-w-projects-min border-collapse text-fs-body-sm">
          <thead>
            <tr className="bg-surface-subtle">
              <Th>BioProject</Th>
              <Th>Title</Th>
              <Th align="right">BioSamples</Th>
              <Th align="right">SRA Experiments</Th>
              <Th>Assay</Th>
              {fields.map((field) => (
                <Th key={field} minWidth>
                  {fieldLabel(field)} composition
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(projects.data?.items ?? []).map((project) => (
              <ProjectRow key={project.identifier} project={project} condition={condition} fields={fields} />
            ))}
          </tbody>
        </table>
      </div>
      <CardFooter>
        <div className="ml-auto">
          <Pager page={state.page} perPage={TABLE_PER_PAGE} total={total} onChange={table.onFootPage} />
        </div>
      </CardFooter>
    </Card>
  )
}

const Th = ({ children, align = "left", minWidth = false }: { children: ReactNode; align?: "left" | "right"; minWidth?: boolean }) => (
  <th
    className={cn(
      "border-b border-border-soft px-2.5 py-2 text-fs-label font-semibold whitespace-nowrap text-ink-soft",
      align === "right" ? "text-right" : "text-left",
      minWidth && "min-w-40",
    )}
  >
    {children}
  </th>
)

type ProjectRowProps = {
  project: Project
  condition: Condition
  fields: string[]
}

const ProjectRow = ({ project, condition, fields }: ProjectRowProps) => {
  const selected = condition.isSelected(project.clauses)
  const compositionByField = new Map(project.composition.map((composition) => [composition.field, composition]))
  return (
    <tr
      onClick={() => void condition.toggle(project.clauses)}
      className={cn("cursor-pointer border-b border-brand-soft hover:bg-brand-soft", selected && "bg-brand-soft")}
    >
      <td className="px-2.5 py-1.5 font-mono text-fs-label whitespace-nowrap text-brand">
        {project.identifier}
        {selected && <span className="ml-1.5 font-sans text-fs-micro font-semibold">✓</span>}
      </td>
      <td className="min-w-70 max-w-95 truncate px-2.5 py-1.5" title={project.title ?? ""}>
        {project.title}
      </td>
      <td className="px-2.5 py-1.5 text-right font-mono text-fs-label">{formatCount(project.biosampleCount)}</td>
      <td className="px-2.5 py-1.5 text-right font-mono text-fs-label">{formatCount(project.experimentCount)}</td>
      <td className="px-2.5 py-1.5 whitespace-nowrap">
        <span className="flex flex-wrap gap-1">
          {project.assays.map((assay) => (
            <Tag key={assay}>{assay}</Tag>
          ))}
        </span>
      </td>
      {fields.map((field) => {
        const composition = compositionByField.get(field)
        return (
          <td key={field} className="min-w-40 px-2.5 py-1.5">
            {composition && <CompositionCell composition={composition} />}
          </td>
        )
      })}
    </tr>
  )
}

const CompositionCell = ({ composition }: { composition: Composition }) => (
  <div>
    <div className="flex h-2.5 w-composition gap-px overflow-hidden rounded-badge">
      {compositionSegments(composition).map((segment) => (
        <div key={segment.kind} className={cn("h-full", SEGMENT_COLOR[segment.kind])} style={{ width: `${segment.pct}%` }} title={segment.title} />
      ))}
    </div>
    <div className="mt-0.5 truncate text-fs-micro text-ink-soft">{compositionSummary(composition)}</div>
  </div>
)
