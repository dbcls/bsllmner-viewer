import { useEffect, useState } from "react"

import { exportAccessionsUrl, exportEntriesUrl } from "~/lib/api/client"
import { useDataset } from "~/lib/api/queries"
import type { AccessionType } from "~/lib/api/types"
import { copyText } from "~/lib/export"
import { formatCount } from "~/lib/format"
import { ACTION_ICON, CopyButton, MenuButton, Modal } from "~/ui"

import { TAB_LABELS, type WorkspaceState } from "./state"
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

/** The outputs of the condition: entry exports and accession lists. */
export const ExportMenu = ({ q, totalEntries }: ExportMenuProps) => (
  <MenuButton
    label="Export"
    icon={ACTION_ICON.download}
    appearance="bar"
    monoHints
    items={[
      {
        title: "Entries",
        note: "all annotation fields",
        items: [
          {
            label: "TSV",
            href: exportEntriesUrl("biosample", q, "tsv"),
            ...(totalEntries === undefined ? {} : { hint: `${formatCount(totalEntries)} rows` }),
          },
          { label: "JSON lines", href: exportEntriesUrl("biosample", q, "ndjson") },
        ],
      },
      {
        title: "Accession lists",
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

export const ApiModal = ({ open, onClose, state, onAlert }: ApiModalProps) => {
  const [response, setResponse] = useState<string>("")
  const dataset = useDataset()
  const requests = apiRequestsFor(state, dataset.data ? dataset.data.fields.map((f) => f.name) : null)
  const [first] = requests
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const curl = requests.map((request) => `curl -s "${origin}${request}" \\\n  -H "Accept: application/json"`).join("\n\n")
  useEffect(() => {
    if (!open || first === undefined) return
    let cancelled = false
    setResponse("")
    fetch(first)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setResponse(responseExcerpt(text))
      })
      .catch(() => setResponse("(request failed)"))
    return () => {
      cancelled = true
    }
  }, [open, first])
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      align="center"
      title="Same result via the API"
      description={
        state.tab === "distribution"
          ? "Each card of the Distribution view is one request for the current condition, listed in the order of the cards. Same q, same unit."
          : `Returns the ${TAB_LABELS[state.tab]} view for the current condition. Same q, same unit.`
      }
    >
      <div className="px-6 pb-6">
        <h3 className={BLOCK_HEADING}>{requests.length > 1 ? "Requests" : "Request"}</h3>
        <div className="relative mb-4">
          <pre className="max-h-60 overflow-auto rounded-button bg-ink py-3 pr-28 pl-3.5 font-mono text-fs-label leading-relaxed break-all whitespace-pre-wrap text-brand-soft">{curl}</pre>
          <span className="absolute top-2 right-2">
            <CopyButton
              kind="inverse"
              onCopy={async () => {
                const ok = await copyText(curl)
                if (!ok) onAlert("Copy failed")
                return ok
              }}
            >
              Copy
            </CopyButton>
          </span>
        </div>
        <h3 className={BLOCK_HEADING}>{requests.length > 1 ? "Response to the first request (excerpt)" : "Response (excerpt)"}</h3>
        <pre className="max-h-64 overflow-auto rounded-button border border-border-soft bg-surface-subtle px-3.5 py-3 font-mono text-fs-label leading-relaxed whitespace-pre-wrap text-ink-mid">
          {response || "Loading…"}
        </pre>
      </div>
    </Modal>
  )
}
