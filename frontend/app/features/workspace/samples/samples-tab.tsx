import { Fragment, type MouseEvent } from "react"
import { Link, useNavigate } from "react-router"

import { useDataset, useEntries } from "~/lib/api/queries"
import type { AnnotationValue, EntryItem } from "~/lib/api/types"
import { backLinkState } from "~/lib/back-link"
import { ddbjSearchHref, ncbiHref } from "~/lib/external-links"
import { fieldLabel, hasStatusValue, statusInfo, VALUE_STATUSES } from "~/lib/labels"
import type { TablePerPage } from "~/lib/workspace-state"
import { Card, CardFooter, CardHeader, cn, ExternalLink, FrozenTd, HelpHint, InlineLabel, Pager, StatusGlyph, StatusMeanings, StatusPill, TableScroller } from "~/ui"

import { AssayTags } from "../assay-tags"
import { PerPageChooser } from "../per-page-chooser"
import { SkeletonTableRows } from "../skeleton-rows"
import type { WorkspaceState } from "../state"
import { TABLE_CELL, Th } from "../table"
import { useTableTop } from "../use-table-top"

/** The page of a BioSample. */
const sampleHref = (accession: string): string => `/entries/${accession}`

/** An annotation with an extracted value. A cell leaves a field without one (not stated, or extraction failed) empty. */
const hasValue = (value: AnnotationValue): boolean => hasStatusValue(value.status)

/** The statuses that the cells mark, and so the legend names. */
const CELL_STATUSES = VALUE_STATUSES.map((code) => ({ code, ...statusInfo(code) }))

/** One width for every annotation column, so that the columns line up; a longer value ends in an ellipsis. */
const ANNOTATION_WIDTH = "w-36 min-w-36 max-w-36"

/** The width of the first column, which stays put when the table scrolls sideways. It holds the longest accession. */
const FROZEN_WIDTH = "w-36 min-w-36 max-w-36"

type SamplesTabProps = {
  state: WorkspaceState
  onPage: (page: number) => void
  onPerPage: (perPage: TablePerPage) => void
  search: string
}

/** The entry list: one row per BioSample, filtered by the full condition. */
export const SamplesTab = ({ state, onPage, onPerPage, search }: SamplesTabProps) => {
  const navigate = useNavigate()
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const entries = useEntries({ q: state.q, page: state.page, perPage: state.perPage })
  const total = entries.data?.pagination.total
  const table = useTableTop(onPage)
  // A row opens its BioSample as its link does: a click with Cmd or Ctrl, or with the middle button, opens a new tab, which
  // has no list to return to; a plain click opens it here, with the list to return to.
  const openRow = (event: MouseEvent, accession: string) => {
    if (event.metaKey || event.ctrlKey || event.button === 1) window.open(sampleHref(accession), "_blank", "noopener")
    else void navigate(sampleHref(accession), { state: backLinkState(search) })
  }

  return (
    <Card ref={table.ref} padding="none" flush busy={entries.isPlaceholderData}>
      <CardHeader>
        <div className="flex min-w-0 grow basis-80 items-center">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <InlineLabel>Status</InlineLabel>
            {CELL_STATUSES.map((status) => (
              <StatusPill key={status.code} mark={status.mark} tone={status.tone} label={status.label} size="sm" />
            ))}
          </div>
          <HelpHint label="About the status marks">{STATUS_HELP}</HelpHint>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <PerPageChooser value={state.perPage} onChange={onPerPage} />
          <Pager page={state.page} perPage={state.perPage} total={total} onChange={onPage} />
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
            {entries.data === undefined && <SkeletonTableRows rows={state.perPage} columns={[...LEAD_SKELETONS, ...fields.map(() => "w-24"), "w-20"]} frozen />}
            {(entries.data?.items ?? []).map((row) => (
              <tr
                key={row.identifier}
                onClick={(event) => openRow(event, row.identifier)}
                onAuxClick={(event) => event.button === 1 && openRow(event, row.identifier)}
                className="group cursor-pointer hover:bg-brand-soft"
              >
                <FrozenTd className={cn(TABLE_CELL, FROZEN_WIDTH, "truncate font-mono text-fs-label whitespace-nowrap")}>
                  <Link
                    to={sampleHref(row.identifier)}
                    state={backLinkState(search)}
                    onClick={(event) => event.stopPropagation()}
                    onAuxClick={(event) => event.stopPropagation()}
                    className="text-brand no-underline hover:text-brand-deep"
                  >
                    {row.identifier}
                  </Link>
                </FrozenTd>
                <td className={cn(TABLE_CELL, "max-w-64 truncate")} title={row.title ?? ""}>
                  {row.title}
                </td>
                <td className={cn(TABLE_CELL, "whitespace-nowrap text-ink-mid")}>{row.organism?.name}</td>
                <td className={cn(TABLE_CELL, "whitespace-nowrap")}>
                  <AssayTags assays={row.libraryStrategy} targetAssays={dataset.data?.targetAssays ?? []} />
                </td>
                <td className={cn(TABLE_CELL, "font-mono text-fs-label whitespace-nowrap")}>
                  <BioProjectLinks accessions={row.bioprojects} />
                </td>
                <td className={cn(TABLE_CELL, "font-mono text-fs-label whitespace-nowrap")}>{row.datePublished}</td>
                {fields.map((field) => {
                  const values = (row.annotations[field] ?? []).filter(hasValue)
                  return (
                    <td key={field} className={cn(TABLE_CELL, ANNOTATION_WIDTH, "truncate whitespace-nowrap")} title={annotationTitle(field, values) || undefined}>
                      <AnnotationCell values={values} />
                    </td>
                  )
                })}
                <td className={cn(TABLE_CELL, "text-fs-label whitespace-nowrap")}>
                  <RowLinks row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      <CardFooter>
        <div className="ml-auto">
          <Pager page={state.page} perPage={state.perPage} total={total} onChange={table.onFootPage} />
        </div>
      </CardFooter>
    </Card>
  )
}

/** The widths of the skeletons of the columns before the annotation columns, near the widths of their values. */
const LEAD_SKELETONS = ["w-24", "w-48", "w-24", "w-16", "w-20", "w-20"]

const STATUS_HELP = (
  <StatusMeanings statuses={CELL_STATUSES}>
    {"A value in quotes is the extracted text, for which no term was adopted."}
    {"An empty cell has no extracted value."}
  </StatusMeanings>
)

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
              <StatusGlyph mark={info.mark} tone={info.tone} label={info.label} />
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
      return `${fieldLabel(field)}: extracted “${value.value ?? ""}” → ${target}, ${statusInfo(value.status).label}`
    })
    .join("\n")

/** The pages of the row's BioProjects in DDBJ Search. */
const BioProjectLinks = ({ accessions }: { accessions: string[] }) =>
  accessions.map((accession, index) => (
    <Fragment key={accession}>
      {index > 0 && ", "}
      <ExternalLink href={ddbjSearchHref("bioproject", accession)}>{accession}</ExternalLink>
    </Fragment>
  ))

/** The pages of the row's BioSample in DDBJ Search and NCBI. */
const RowLinks = ({ row }: { row: EntryItem }) => (
  <span className="inline-flex gap-3">
    <ExternalLink href={ddbjSearchHref("biosample", row.identifier)}>DDBJ</ExternalLink>
    <ExternalLink href={ncbiHref("biosample", row.identifier)}>NCBI</ExternalLink>
  </span>
)
