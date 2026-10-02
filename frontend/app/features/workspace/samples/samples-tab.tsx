import { Fragment, type ReactNode } from "react"
import { useNavigate } from "react-router"

import { useDataset, useEntries } from "~/lib/api/queries"
import type { AnnotationValue, EntryItem } from "~/lib/api/types"
import { fieldLabel, STATUS_ORDER, statusInfo } from "~/lib/labels"
import { TABLE_PER_PAGE } from "~/lib/workspace-state"
import { Card, CardFooter, CardHeader, cn, ExternalLink, FrozenTd, FrozenTh, HelpHint, InlineLabel, Pager, StatusGlyph, StatusPill, TableScroller } from "~/ui"

import { AssayTags } from "../assay-tags"
import { SkeletonTableRows } from "../skeleton-rows"
import type { WorkspaceState } from "../state"
import { useTableTop } from "../use-table-top"

/** An annotation with an extracted value. A cell leaves a field without one (not stated, or extraction failed) empty. */
const hasValue = (value: AnnotationValue): boolean => statusInfo(value.status).group !== "no_value"

/** The statuses that the cells mark, and so the legend names. */
const CELL_STATUSES = STATUS_ORDER.filter((status) => statusInfo(status).group !== "no_value")

/** One width for every annotation column, so that the columns line up; a longer value ends in an ellipsis. */
const ANNOTATION_WIDTH = "w-36 min-w-36 max-w-36"

/** The width of the first column, which stays put when the table scrolls sideways. It holds the longest accession. */
const FROZEN_WIDTH = "w-36 min-w-36 max-w-36"

/**
 * The rule is on the cells rather than the row: the table has separate borders, which the frozen column needs. The last row
 * has none, so that it does not double the line over the footer.
 */
const TD = "border-b border-brand-soft px-2.5 py-1.5 group-last:border-b-0"

type SamplesTabProps = {
  state: WorkspaceState
  onPage: (page: number) => void
  search: string
}

/** The entry list: one row per BioSample, filtered by the full condition. */
export const SamplesTab = ({ state, onPage, search }: SamplesTabProps) => {
  const navigate = useNavigate()
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const entries = useEntries({ q: state.q, page: state.page, perPage: TABLE_PER_PAGE })
  const total = entries.data?.pagination.total
  const table = useTableTop(onPage)

  return (
    <Card ref={table.ref} padding="none" flush busy={entries.isPlaceholderData}>
      <CardHeader>
        <div className="flex min-w-0 grow basis-80 flex-wrap items-center gap-x-1.5 gap-y-1">
          <InlineLabel>Status</InlineLabel>
          {CELL_STATUSES.map((status) => (
            <StatusPill key={status} status={status} label={statusInfo(status).label} size="sm" />
          ))}
          <HelpHint label="About the status marks">{STATUS_HELP}</HelpHint>
        </div>
        <div className="ml-auto">
          <Pager page={state.page} perPage={TABLE_PER_PAGE} total={total} onChange={onPage} />
        </div>
      </CardHeader>
      <TableScroller>
        <table className="w-full min-w-table-min border-separate border-spacing-0 text-fs-body-sm">
          <thead>
            <tr className="bg-surface-subtle">
              <Th width={FROZEN_WIDTH} frozen>
                BioSample
              </Th>
              {["Title", "Organism", "Assay", "BioProject", "Published"].map((column) => (
                <Th key={column}>{column}</Th>
              ))}
              {fields.map((field) => (
                <Th key={field} width={ANNOTATION_WIDTH}>
                  {fieldLabel(field)}
                </Th>
              ))}
              <Th>Links</Th>
            </tr>
          </thead>
          <tbody>
            {entries.data === undefined && <SkeletonTableRows columns={[...LEAD_SKELETONS, ...fields.map(() => "w-24"), "w-20"]} frozen />}
            {(entries.data?.items ?? []).map((row) => (
              <tr
                key={row.identifier}
                onClick={() => navigate(`/entries/${row.identifier}${search ? `?from=${encodeURIComponent(search)}` : ""}`)}
                className="group cursor-pointer hover:bg-brand-soft"
              >
                <FrozenTd className={cn(TD, FROZEN_WIDTH, "truncate font-mono text-fs-label whitespace-nowrap text-brand")}>{row.identifier}</FrozenTd>
                <td className={cn(TD, "max-w-64 truncate")} title={row.title ?? ""}>
                  {row.title}
                </td>
                <td className={cn(TD, "whitespace-nowrap text-ink-mid")}>{row.organism?.name}</td>
                <td className={cn(TD, "whitespace-nowrap")}>
                  <AssayTags assays={row.libraryStrategy} targetAssays={dataset.data?.targetAssays ?? []} />
                </td>
                <td className={cn(TD, "font-mono text-fs-label whitespace-nowrap")}>
                  <BioProjectLinks accessions={row.bioprojects} />
                </td>
                <td className={cn(TD, "font-mono text-fs-label whitespace-nowrap")}>{row.datePublished}</td>
                {fields.map((field) => {
                  const values = (row.annotations[field] ?? []).filter(hasValue)
                  return (
                    <td key={field} className={cn(TD, ANNOTATION_WIDTH, "truncate whitespace-nowrap")} title={annotationTitle(field, values) || undefined}>
                      <AnnotationCell values={values} />
                    </td>
                  )
                })}
                <td className={cn(TD, "text-fs-label whitespace-nowrap")}>
                  <RowLinks row={row} />
                </td>
              </tr>
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

/** The widths of the skeletons of the columns before the annotation columns, near the widths of their values. */
const LEAD_SKELETONS = ["w-24", "w-48", "w-24", "w-16", "w-20", "w-20"]

const STATUS_MEANING: Record<string, string> = {
  mapped_exact: "The value matched an ontology label or synonym exactly.",
  mapped_selected: "The LLM selected the term from the candidate terms.",
  unmapped_no_candidate: "No ontology term resembled the value.",
  unmapped_rejected: "Similar terms existed, but the LLM adopted none.",
}

const STATUS_HELP = (
  <>
    {CELL_STATUSES.map((status, index) => (
      <span key={status} className={cn("block", index > 0 && "mt-1.5")}>
        <StatusPill status={status} label={statusInfo(status).label} size="sm" /> {STATUS_MEANING[status]}
      </span>
    ))}
    <span className="mt-1.5 block">A value in quotes is the extracted text, for which no term was adopted.</span>
    <span className="mt-1.5 block">An empty cell has no extracted value.</span>
  </>
)

type ThProps = {
  children: ReactNode
  /** A fixed width for the column, whose header then ends in an ellipsis instead of widening it. */
  width?: string
  /** The column stays put when the table scrolls sideways. */
  frozen?: boolean
}

const Th = ({ children, width, frozen = false }: ThProps) => {
  const className = cn(
    "border-b border-border-soft px-2.5 py-2 text-left text-fs-label font-semibold whitespace-nowrap text-ink-soft",
    width && cn(width, "truncate"),
  )
  return frozen ? <FrozenTh className={className}>{children}</FrozenTh> : <th className={className}>{children}</th>
}

const AnnotationCell = ({ values }: { values: AnnotationValue[] }) => {
  if (values.length === 0) return null
  return (
    <>
      {values.map((value, index) => {
        const info = statusInfo(value.status)
        const text = value.termId ? (value.label ?? value.termId) : value.value ? `“${value.value}”` : ""
        return (
          <span key={index} className={index > 0 ? "ml-1.5" : ""}>
            <span className="mr-1">
              <StatusGlyph status={value.status} label={info.label} />
            </span>
            <span className={value.termId ? "text-ink" : "text-ink-soft"}>{text}</span>
          </span>
        )
      })}
    </>
  )
}

const annotationTitle = (field: string, values: AnnotationValue[]): string =>
  values
    .map((value) => {
      const target = value.termId ? `${value.label ?? ""} (${value.termId})` : "no term"
      return `${fieldLabel(field)}: extracted “${value.value ?? ""}” → ${target} · ${statusInfo(value.status).label}`
    })
    .join("\n")

/** The pages of the row's BioProjects in DDBJ Search. */
const BioProjectLinks = ({ accessions }: { accessions: string[] }) =>
  accessions.map((accession, index) => (
    <Fragment key={accession}>
      {index > 0 && ", "}
      <ExternalLink href={`https://ddbj.nig.ac.jp/search/entry/bioproject/${accession}`}>{accession}</ExternalLink>
    </Fragment>
  ))

/** The pages of the row's BioSample in DDBJ Search and NCBI. */
const RowLinks = ({ row }: { row: EntryItem }) => (
  <>
    <ExternalLink href={`https://ddbj.nig.ac.jp/search/entry/biosample/${row.identifier}`}>DDBJ</ExternalLink>
    {" · "}
    <ExternalLink href={`https://www.ncbi.nlm.nih.gov/biosample/${row.identifier}`}>NCBI</ExternalLink>
  </>
)
