import type { ReactNode } from "react"
import { useState } from "react"

import { useDataset, useProjects } from "~/lib/api/queries"
import type { Composition, Project, ProjectSort } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel } from "~/lib/labels"
import { Card, CardFooter, CardHeader, cn, Pager, Segmented, Tag } from "~/ui"

import { clausesOfField, leaves } from "../ast"
import type { WorkspaceState } from "../state"
import type { Condition } from "../use-condition"
import { compositionSegments, compositionSummary } from "./composition"

const PER_PAGE = 25
const FALLBACK_FIELDS = ["disease", "cell_line", "tissue"]

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
}

/** BioProjects matching the condition, with a composition summary of up to 3 annotation fields per project. */
export const ProjectsTab = ({ state, condition, onPage }: ProjectsTabProps) => {
  const [sort, setSort] = useState<ProjectSort>("biosampleCount:desc")
  const dataset = useDataset()
  const annotationFields = new Set((dataset.data?.fields ?? []).map((field) => field.name))
  const conditionFields = [
    ...new Set(leaves(condition.ast).map((leaf) => leaf.field).filter((field) => annotationFields.has(field))),
  ].slice(0, 3)
  const compositionFields = (conditionFields.length ? conditionFields : FALLBACK_FIELDS).join(",")
  const projects = useProjects({
    q: state.q,
    selfExclusion: state.selfExclusion,
    sort,
    page: state.page,
    perPage: PER_PAGE,
    compositionFields,
  })
  const total = projects.data?.pagination.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const fields = projects.data?.compositionFields ?? compositionFields.split(",")
  const bioprojectFiltered = state.selfExclusion && clausesOfField(condition.ast, "bioproject").length > 0

  return (
    <Card padding="none" flush>
      <CardHeader>
        <span className="inline-flex items-center gap-1.5">
          {projects.data ? `${formatCount(total)} BioProjects match · page ${state.page} of ${pages}` : "Counting…"}
          {bioprojectFiltered && <Tag kind="warn">Not filtered by BioProject</Tag>}
        </span>
        <span className="inline-flex items-center gap-1.5">
          Sort by
          <Segmented
            ariaLabel="Sort by"
            options={[
              { value: "biosampleCount:desc", label: "BioSamples" },
              { value: "experimentCount:desc", label: "SRA Experiments" },
              { value: "identifier:asc", label: "Accession" },
            ]}
            value={sort}
            onChange={setSort}
          />
        </span>
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
        <div className="flex flex-col gap-1 text-fs-micro">
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
        <Pager page={state.page} pages={pages} onChange={onPage} />
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
