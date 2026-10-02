import type { ReactNode } from "react"

import { useDataset, useProjects } from "~/lib/api/queries"
import type { Project, ProjectSort } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { TABLE_PER_PAGE } from "~/lib/workspace-state"
import { ACTION_ICON, Button, Card, CardFooter, CardHeader, cn, ExternalLink, Pager, SortChooser, type SortDirection, type SortKey, TableScroller } from "~/ui"

import { AssayTags } from "../assay-tags"
import { SkeletonTableRows } from "../skeleton-rows"
import type { WorkspaceState } from "../state"
import type { Condition } from "../use-condition"
import { useTableTop } from "../use-table-top"

type ProjectSortKey = "biosampleCount" | "experimentCount"

const SORT_KEYS: (SortKey & { value: ProjectSortKey })[] = [
  { value: "biosampleCount", label: "BioSamples", direction: "desc" },
  { value: "experimentCount", label: "SRA Experiments", direction: "desc" },
]

const projectSort = (key: string, direction: SortDirection): ProjectSort =>
  `${SORT_KEYS.find((option) => option.value === key)?.value ?? "biosampleCount"}:${direction}`

type ProjectsTabProps = {
  state: WorkspaceState
  condition: Condition
  onPage: (page: number) => void
  onSort: (sort: ProjectSort) => void
}

/**
 * The BioProjects of the entries that match the condition without its BioProject clauses, so that the BioProjects added to
 * the condition stay among the others.
 */
export const ProjectsTab = ({ state, condition, onPage, onSort }: ProjectsTabProps) => {
  const table = useTableTop(onPage)
  const projects = useProjects({ q: state.q, selfExclusion: true, sort: state.sort, page: state.page, perPage: TABLE_PER_PAGE })
  const targetAssays = useDataset().data?.targetAssays ?? []
  const [sortKey = "biosampleCount", sortDirection = "desc"] = state.sort.split(":") as [ProjectSortKey, SortDirection]
  const total = projects.data?.pagination.total

  return (
    <Card ref={table.ref} padding="none" flush busy={projects.isPlaceholderData}>
      <CardHeader>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <SortChooser keys={SORT_KEYS} value={sortKey} direction={sortDirection} onChange={(key, direction) => onSort(projectSort(key, direction))} />
          <Pager page={state.page} perPage={TABLE_PER_PAGE} total={total} onChange={onPage} />
        </div>
      </CardHeader>
      <TableScroller>
        <table className="w-full min-w-projects-min border-separate border-spacing-0 text-fs-body-sm">
          <thead>
            <tr className="bg-surface-subtle">
              <Th>BioProject</Th>
              <Th>Title</Th>
              <Th align="right">BioSamples</Th>
              <Th align="right">SRA Experiments</Th>
              <Th>Assay</Th>
              <Th>Links</Th>
              <Th>Condition</Th>
            </tr>
          </thead>
          <tbody>
            {projects.data === undefined && <SkeletonTableRows columns={["w-24", "w-64", "w-12", "w-12", "w-16", "w-20", "w-16"]} />}
            {(projects.data?.items ?? []).map((project) => (
              <ProjectRow key={project.identifier} project={project} condition={condition} targetAssays={targetAssays} />
            ))}
          </tbody>
        </table>
      </TableScroller>
      <CardFooter>
        <div className="ml-auto">
          <Pager page={state.page} perPage={TABLE_PER_PAGE} total={total} onChange={table.onFootPage} />
        </div>
      </CardFooter>
    </Card>
  )
}

const Th = ({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) => (
  <th
    className={cn(
      "border-b border-border-soft px-2.5 py-2 text-fs-label font-semibold whitespace-nowrap text-ink-soft",
      align === "right" ? "text-right" : "text-left",
    )}
  >
    {children}
  </th>
)

/**
 * The rule is on the cells rather than the row, as in the Samples table. The last row has none, so that it does not double
 * the line over the footer.
 */
const TD = "border-b border-brand-soft px-2.5 py-1.5 group-last:border-b-0"

type ProjectRowProps = {
  project: Project
  condition: Condition
  targetAssays: readonly string[]
}

const ProjectRow = ({ project, condition, targetAssays }: ProjectRowProps) => {
  const selected = condition.isSelected(project.clauses)
  return (
    <tr className={cn("group", selected && "bg-brand-soft")}>
      <td className={cn(TD, "font-mono text-fs-label whitespace-nowrap")}>{project.identifier}</td>
      <td className={cn(TD, "w-full max-w-0 truncate")} title={project.title ?? ""}>
        {project.title}
      </td>
      <td className={cn(TD, "text-right font-mono text-fs-label")}>{formatCount(project.biosampleCount)}</td>
      <td className={cn(TD, "text-right font-mono text-fs-label")}>{formatCount(project.experimentCount)}</td>
      <td className={cn(TD, "whitespace-nowrap")}>
        <AssayTags assays={project.assays} targetAssays={targetAssays} />
      </td>
      <td className={cn(TD, "text-fs-label whitespace-nowrap")}>
        <ProjectLinks identifier={project.identifier} />
      </td>
      <td className={cn(TD, "whitespace-nowrap")}>
        {/*
          One width for both labels, so the columns do not move when a project is added or removed. The negative margin
          keeps the button, a little taller than a line of text, from making the row taller than a row of the Samples table.
        */}
        <div className="-my-px flex w-22">
          <ConditionButton project={project} selected={selected} onToggle={() => void condition.toggle(project.clauses)} />
        </div>
      </td>
    </tr>
  )
}

const ConditionButton = ({ project, selected, onToggle }: { project: Project; selected: boolean; onToggle: () => void }) =>
  selected ? (
    <Button kind="quiet" size="2xs" block icon={ACTION_ICON.clear} aria-label={`Remove ${project.identifier} from the condition`} onClick={onToggle}>
      Remove
    </Button>
  ) : (
    <Button kind="quiet" size="2xs" block icon={ACTION_ICON.add} aria-label={`Add ${project.identifier} to the condition`} onClick={onToggle}>
      Add
    </Button>
  )

const ProjectLinks = ({ identifier }: { identifier: string }) => (
  <>
    <ExternalLink href={`https://ddbj.nig.ac.jp/search/entry/bioproject/${identifier}`}>DDBJ</ExternalLink>
    {" · "}
    <ExternalLink href={`https://www.ncbi.nlm.nih.gov/bioproject/${identifier}`}>NCBI</ExternalLink>
  </>
)
