import { useEffect, useState } from "react"

import { ApiError, canTryAgain, exportAccessionsUrl, exportEntriesUrl, loadFailureProps } from "~/lib/api/client"
import { queryFailed, useDataset } from "~/lib/api/queries"
import type { AccessionType } from "~/lib/api/types"
import { copyText } from "~/lib/export"
import { formatSize } from "~/lib/format"
import { ACTION_ICON, CopyButton, ErrorNotice, MenuButton, Modal, Skeleton } from "~/ui"

import { type Tab, TAB_LABELS, type WorkspaceState } from "./state"
import { apiRequestsFor } from "./view-requests"

type ExportMenuProps = {
  q: string | null
  totalEntries: number | undefined
}

// A record, so that the type checker reports an accession type that the api adds and this list lacks.
const ACCESSION_TYPES: Record<AccessionType, { label: string; hint: string }> = {
  biosample: { label: "BioSample", hint: "SAMN…" },
  "sra-experiment": { label: "SRA Experiment", hint: "SRX…" },
  "sra-run": { label: "SRA Run", hint: "SRR…" },
  bioproject: { label: "BioProject", hint: "PRJ…" },
}

/**
 * The bytes of one entry in an export, for the size that the menu shows before a download, so that a download of
 * gigabytes is not started by chance. They are measured on the dataset that the site serves. Measure them again when
 * the dataset changes.
 */
const ENTRY_BYTES = { tsv: 300, ndjson: 1000 } as const

type EntryFormat = keyof typeof ENTRY_BYTES

/** The size that an export of the entries is likely to have, marked as an estimate unless it is under 1 KB. */
const entrySize = (totalEntries: number, format: EntryFormat): string => {
  const size = formatSize(totalEntries * ENTRY_BYTES[format])
  return size.startsWith("<") ? size : `~${size}`
}

/** The entry export of a format, with the size it is likely to have once the number of entries is known. */
const entryExport = (q: string | null, totalEntries: number | undefined, format: EntryFormat, label: string) => ({
  label,
  href: exportEntriesUrl("biosample", q, format),
  ...(totalEntries === undefined ? {} : { hint: entrySize(totalEntries, format) }),
})

/** The outputs of the condition: entry exports and accession lists. */
export const ExportMenu = ({ q, totalEntries }: ExportMenuProps) => (
  <MenuButton
    label="Export"
    icon={ACTION_ICON.download}
    appearance="bar"
    monoHints
    items={[
      {
        title: "Matching entries",
        note: "all annotation fields",
        items: [entryExport(q, totalEntries, "tsv", "TSV"), entryExport(q, totalEntries, "ndjson", "NDJSON")],
      },
      {
        title: "Matching accessions",
        note: "one per line",
        items: (Object.entries(ACCESSION_TYPES) as [AccessionType, (typeof ACCESSION_TYPES)[AccessionType]][]).map(([type, { label, hint }]) => ({
          label,
          hint,
          href: exportAccessionsUrl(type, q),
        })),
      },
    ]}
  />
)

type ApiModalProps = {
  open: boolean
  onClose: () => void
  state: WorkspaceState
  onAlert: (message: string) => void
}

/** The longest response the dialog shows before it cuts the rest. */
const EXCERPT_LENGTH = 2500

/**
 * The response as the dialog shows it: indented JSON without `datasetVersion`, so the part that answers the request
 * comes first, cut at `EXCERPT_LENGTH`. A body that is not JSON is cut as it is.
 */
export const responseExcerpt = (text: string): string => {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return text.slice(0, EXCERPT_LENGTH)
  }
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    body = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "datasetVersion"))
  }
  const pretty = JSON.stringify(body, null, 2)
  return pretty.length > EXCERPT_LENGTH ? `${pretty.slice(0, EXCERPT_LENGTH)}\n  …` : pretty
}

const BLOCK_HEADING = "mb-1.5 text-fs-body-sm font-semibold text-ink"

/** What the dialog shows for the response of the first request. */
type Shown = { kind: "loading" } | { kind: "body"; text: string } | { kind: "failed"; text: string; retry: boolean }

/** The one line that says why a response failed: its status and the title that the api gave it, or the status text of the response. */
const failureLine = (response: Response, body: string): string => {
  let title = ""
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === "object" && parsed !== null && "title" in parsed && typeof parsed.title === "string") title = parsed.title
  } catch {
    // A body that is not JSON, such as the page of a proxy, has no title.
  }
  return `${response.status} ${title || response.statusText}`.trim()
}

/** The sentence under the title of the API dialog. Only the requests of the views that count in a unit say that the unit is the same. */
export const apiDialogDescription = (tab: Tab): string => {
  if (tab === "distribution") return "Each card of the Distribution view is one request for the current condition, counted in the same unit, in the order of the cards."
  if (tab === "samples" || tab === "projects") return `Returns the ${TAB_LABELS[tab]} view for the current condition.`
  return `Returns the ${TAB_LABELS[tab]} view for the current condition, counted in the same unit.`
}

const UNREACHABLE = "Could not reach the server."

export const ApiModal = ({ open, onClose, state, onAlert }: ApiModalProps) => {
  const [response, setResponse] = useState<Shown>({ kind: "loading" })
  const [attempt, setAttempt] = useState(0)
  const dataset = useDataset()
  const requests = apiRequestsFor(state, dataset.data ? dataset.data.fields.map((f) => f.name) : null)
  const [first] = requests
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const curl = requests.map((request) => `curl -s "${origin}${request}" \\\n  -H "Accept: application/json"`).join("\n\n")
  useEffect(() => {
    if (!open || first === undefined) return
    let cancelled = false
    setResponse({ kind: "loading" })
    fetch(first)
      .then(async (r) => {
        const text = await r.text()
        if (!cancelled) setResponse(r.ok ? { kind: "body", text: responseExcerpt(text) } : { kind: "failed", text: failureLine(r, text), retry: canTryAgain(new ApiError({ type: "about:blank", title: "", status: r.status })) })
      })
      .catch(() => {
        if (!cancelled) setResponse({ kind: "failed", text: UNREACHABLE, retry: true })
      })
    return () => {
      cancelled = true
    }
  }, [open, first, attempt])
  const datasetFailed = queryFailed(dataset)
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      align="center"
      title="Same result via the API"
      description={apiDialogDescription(state.tab)}
    >
      <div className="px-6 pb-6">
        <h3 className={BLOCK_HEADING}>{requests.length > 1 ? "Requests" : "Request"}</h3>
        <div className="relative mb-4">
          <pre tabIndex={0} role="region" aria-label="Request" aria-busy={requests.length === 0 && !datasetFailed ? true : undefined} className="max-h-64 min-h-12 overflow-auto rounded-button bg-ink py-3 pr-28 pl-3.5 font-mono text-fs-label leading-relaxed break-all whitespace-pre-wrap text-brand-soft">
            {requests.length === 0 && !datasetFailed ? <Skeleton className="w-2/3" /> : curl}
          </pre>
          <span className="absolute top-2 right-2">
            <CopyButton
              kind="inverse"
              onCopy={async () => {
                const ok = await copyText(curl)
                if (!ok) onAlert("Copy failed.")
                return ok
              }}
            >
              Copy
            </CopyButton>
          </span>
        </div>
        <h3 className={BLOCK_HEADING}>{requests.length > 1 ? "Response to the first request (excerpt)" : "Response (excerpt)"}</h3>
        {datasetFailed && requests.length === 0 ? (
          <ErrorNotice {...loadFailureProps(dataset.error, "load the dataset", () => void dataset.refetch(), "dataset")} />
        ) : response.kind === "failed" ? (
          <ErrorNotice message={response.text} {...(response.retry ? { onRetry: () => setAttempt((n) => n + 1) } : {})} />
        ) : (
          <pre
            tabIndex={0}
            role="region"
            aria-label="Response (excerpt)"
            aria-busy={response.kind === "loading" || undefined}
            className="max-h-64 overflow-auto rounded-button border border-border-soft bg-surface-subtle px-3.5 py-3 font-mono text-fs-label leading-relaxed whitespace-pre-wrap text-ink-mid"
          >
            {response.kind === "loading" ? <ResponseSkeleton /> : response.text}
          </pre>
        )}
      </div>
    </Modal>
  )
}

/** The lines of a response before it arrives. */
const ResponseSkeleton = () => (
  <>
    <Skeleton className="w-1/3" />
    <Skeleton className="w-1/2" />
    <Skeleton className="w-2/5" />
  </>
)
