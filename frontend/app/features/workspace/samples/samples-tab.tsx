import { useNavigate } from "react-router"

import { useDataset, useEntries } from "~/lib/api/queries"
import type { AnnotationValue, EntryItem, EntryType } from "~/lib/api/types"
import { fieldLabel, STATUS_ORDER, statusInfo } from "~/lib/labels"
import { TABLE_PER_PAGE } from "~/lib/workspace-state"
import { Card, CardFooter, CardHeader, ExternalLink, Pager, Segmented, StatusGlyph, Tag } from "~/ui"

import type { WorkspaceState } from "../state"
import { useTableTop } from "../use-table-top"

type SamplesTabProps = {
  state: WorkspaceState
  onRows: (rows: EntryType) => void
  onPage: (page: number) => void
  search: string
}

/** The entry list: one row per BioSample or per SRA experiment, filtered by the full condition. */
export const SamplesTab = ({ state, onRows, onPage, search }: SamplesTabProps) => {
  const navigate = useNavigate()
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const entries = useEntries({ q: state.q, type: state.rows, page: state.page, perPage: TABLE_PER_PAGE })
  const total = entries.data?.pagination.total
  const table = useTableTop(onPage)

  return (
    <Card ref={table.ref} padding="none" flush>
      <CardHeader>
        <div className="flex min-w-0 grow basis-80 flex-wrap items-center gap-x-3.5 gap-y-1">
          <span className="font-semibold text-ink-mid">Status</span>
          {STATUS_ORDER.map((status) => {
            const info = statusInfo(status)
            return (
              <span key={status} className="inline-flex items-center gap-1">
                <StatusGlyph status={status} glyph={info.glyph} label={info.label} />
                {info.label}
              </span>
            )
          })}
        </div>
        <span className="inline-flex items-center gap-1.5">
          Rows are
          <Segmented
            ariaLabel="Row unit"
            options={[
              { value: "biosample", label: "BioSamples" },
              { value: "sra-experiment", label: "SRA Experiments" },
            ]}
            value={state.rows}
            onChange={onRows}
          />
        </span>
        <div className="ml-auto">
          <Pager page={state.page} perPage={TABLE_PER_PAGE} total={total} onChange={onPage} />
        </div>
      </CardHeader>
      <div className="overflow-auto">
        <table className="w-full min-w-table-min border-collapse text-fs-body-sm">
          <thead>
            <tr className="bg-surface-subtle">
              {[state.rows === "sra-experiment" ? "SRA Experiment" : "BioSample", "Title", "Organism", "Assay", "BioProject", "Year", ...fields.map(fieldLabel), "Links"].map((column) => (
                <th
                  key={column}
                  className="border-b border-border-soft px-2.5 py-2 text-left text-fs-label font-semibold whitespace-nowrap text-ink-soft"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(entries.data?.items ?? []).map((row) => (
              <tr
                key={`${row.type}/${row.identifier}`}
                onClick={() => navigate(`/entries/${row.biosample}${search ? `?from=${encodeURIComponent(search)}` : ""}`)}
                className="cursor-pointer border-b border-brand-soft hover:bg-brand-soft"
              >
                <td className="px-2.5 py-1.5 font-mono text-fs-label whitespace-nowrap text-brand">{row.identifier}</td>
                <td className="max-w-64 truncate px-2.5 py-1.5" title={row.title ?? ""}>
                  {row.title}
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-mid italic">{row.organism?.name}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <span className="flex gap-1">
                    {row.libraryStrategy.map((assay) => (
                      <Tag key={assay}>{assay}</Tag>
                    ))}
                  </span>
                </td>
                <td className="px-2.5 py-1.5 font-mono text-fs-label whitespace-nowrap">{row.bioprojects.join(", ")}</td>
                <td className="px-2.5 py-1.5 font-mono text-fs-label">{row.dateCreated?.slice(0, 4)}</td>
                {fields.map((field) => (
                  <td key={field} className="max-w-44 truncate px-2.5 py-1.5 whitespace-nowrap" title={annotationTitle(field, row.annotations[field] ?? [])}>
                    <AnnotationCell values={row.annotations[field] ?? []} />
                  </td>
                ))}
                <td className="px-2.5 py-1.5 text-fs-label whitespace-nowrap">
                  <RowLinks row={row} />
                </td>
              </tr>
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
              <StatusGlyph status={value.status} glyph={info.glyph} label={info.label} />
            </span>
            <span className={value.termId ? "text-ink" : "text-ink-mid italic"}>{text}</span>
          </span>
        )
      })}
    </>
  )
}

const annotationTitle = (field: string, values: AnnotationValue[]): string =>
  values
    .map((value) => {
      const info = statusInfo(value.status)
      if (!value.value) return `${fieldLabel(field)}: ${info.label.toLowerCase()}`
      const target = value.termId ? `${value.label ?? ""} (${value.termId})` : "no term"
      return `${fieldLabel(field)}: extracted “${value.value}” → ${target} · ${info.label}`
    })
    .join("\n")

const RowLinks = ({ row }: { row: EntryItem }) => {
  const ncbi = row.biosample.startsWith("SAMN") || row.biosample.startsWith("SAME")
  const chipAtlasExperiment = row.type === "sra-experiment" ? row.identifier : row.experiments[0]
  return (
    <>
      <ExternalLink href={`https://ddbj.nig.ac.jp/search/entry/biosample/${row.biosample}`}>DDBJ</ExternalLink>
      {ncbi && (
        <>
          {" · "}
          <ExternalLink href={`https://www.ncbi.nlm.nih.gov/biosample/${row.biosample}`}>NCBI</ExternalLink>
        </>
      )}
      {row.chipAtlas.length > 0 && chipAtlasExperiment && (
        <>
          {" · "}
          <ExternalLink href={`https://chip-atlas.org/view?id=${chipAtlasExperiment}`}>ChIP-Atlas</ExternalLink>
        </>
      )}
    </>
  )
}
