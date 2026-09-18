import { useNavigate } from "react-router"

import { useDataset, useRecords } from "~/lib/api/queries"
import type { AnnotationValue, RecordRow, RecordUnit } from "~/lib/api/types"
import { formatCount } from "~/lib/format"
import { fieldLabel, STATUS_ORDER, statusInfo, unitLabel } from "~/lib/labels"
import { Card, ExternalLink, Pager, Segmented, StatusGlyph, Tag } from "~/ui"

import type { WorkspaceState } from "../state"

const PER_PAGE = 25

type SamplesTabProps = {
  state: WorkspaceState
  onRows: (rows: RecordUnit) => void
  onPage: (page: number) => void
  search: string
}

/** The record list: one row per BioSample or per experiment, always filtered by the full condition. */
export const SamplesTab = ({ state, onRows, onPage, search }: SamplesTabProps) => {
  const navigate = useNavigate()
  const dataset = useDataset()
  const fields = dataset.data?.fields.map((f) => f.name) ?? []
  const records = useRecords({ q: state.q, unit: state.rows, page: state.page, perPage: PER_PAGE })
  const total = records.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between text-fs-label text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          Rows are
          <Segmented
            ariaLabel="Row unit"
            options={[
              { value: "biosample", label: "BioSamples" },
              { value: "experiment", label: "Experiments" },
            ]}
            value={state.rows}
            onChange={onRows}
          />
        </span>
        <span>
          {records.data ? `${formatCount(total)} ${unitLabel(state.rows)} match` : "Counting…"} · always filtered by the full condition
        </span>
      </div>
      <Card padding="none" flush>
        <div className="overflow-auto">
          <table className="w-full min-w-table-min border-collapse text-fs-body-sm">
            <thead>
              <tr className="bg-surface-subtle">
                {[state.rows === "experiment" ? "Experiment" : "BioSample", "Title", "Organism", "Assay", "BioProject", "Year", ...fields.map(fieldLabel), "Links"].map((column) => (
                  <th
                    key={column}
                    className="border-b border-border-soft px-2.5 py-2 text-left text-fs-micro font-semibold tracking-tag whitespace-nowrap text-ink-soft uppercase"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(records.data?.records ?? []).map((row) => (
                <tr
                  key={`${row.biosample}/${row.experiment ?? ""}`}
                  onClick={() => navigate(`/s/${row.biosample}${search ? `?from=${encodeURIComponent(search)}` : ""}`)}
                  className="cursor-pointer border-b border-brand-soft hover:bg-brand-soft"
                >
                  <td className="px-2.5 py-1.5 font-mono text-fs-label whitespace-nowrap text-brand">{row.experiment ?? row.biosample}</td>
                  <td className="max-w-64 truncate px-2.5 py-1.5" title={row.title ?? ""}>
                    {row.title}
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap text-ink-mid italic">{row.organism_name}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    <span className="flex gap-1">
                      {row.library_strategy.map((assay) => (
                        <Tag key={assay}>{assay}</Tag>
                      ))}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-fs-label whitespace-nowrap">{row.bioprojects.join(", ")}</td>
                  <td className="px-2.5 py-1.5 font-mono text-fs-label">{row.date_created?.slice(0, 4)}</td>
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
      </Card>
      <div className="mt-2.5 flex items-center justify-between text-fs-label text-ink-soft">
        <div className="flex flex-wrap gap-3.5">
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
        <Pager page={state.page} pages={pages} onChange={onPage} />
      </div>
    </div>
  )
}

const AnnotationCell = ({ values }: { values: AnnotationValue[] }) => {
  if (values.length === 0) return null
  return (
    <>
      {values.map((value, index) => {
        const info = statusInfo(value.status)
        const text = value.term_id ? (value.label ?? value.term_id) : value.value ? `“${value.value}”` : ""
        return (
          <span key={index} className={index > 0 ? "ml-1.5" : ""}>
            <span className="mr-1">
              <StatusGlyph status={value.status} glyph={info.glyph} label={info.label} />
            </span>
            <span className={value.term_id ? "text-ink" : "text-ink-mid italic"}>{text}</span>
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
      const target = value.term_id ? `${value.label ?? ""} (${value.term_id})` : "no term"
      return `${fieldLabel(field)}: extracted “${value.value}” → ${target} · ${info.label}`
    })
    .join("\n")

const RowLinks = ({ row }: { row: RecordRow }) => {
  const ncbi = row.biosample.startsWith("SAMN") || row.biosample.startsWith("SAME")
  const chipAtlasExperiment = row.experiment ?? row.experiments[0]
  return (
    <>
      <ExternalLink href={`https://ddbj.nig.ac.jp/search/entry/biosample/${row.biosample}`}>DDBJ</ExternalLink>
      {ncbi && (
        <>
          {" · "}
          <ExternalLink href={`https://www.ncbi.nlm.nih.gov/biosample/${row.biosample}`}>NCBI</ExternalLink>
        </>
      )}
      {row.chip_atlas.length > 0 && chipAtlasExperiment && (
        <>
          {" · "}
          <ExternalLink href={`https://chip-atlas.org/view?id=${chipAtlasExperiment}`}>ChIP-Atlas</ExternalLink>
        </>
      )}
    </>
  )
}
