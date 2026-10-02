import { useEffect, useState } from "react"

import { apiUrl } from "~/lib/api/client"
import { copyText } from "~/lib/export"
import { formatCount } from "~/lib/format"
import { DownloadLink, LinkButton, Modal } from "~/ui"

import type { WorkspaceState } from "./state"

type ExportMenuProps = {
  open: boolean
  onClose: () => void
  q: string | null
  totalRecords: number | undefined
}

const ACCESSION_KINDS = [
  { kind: "biosample", label: "BioSample", hint: "SAMN…" },
  { kind: "experiment", label: "Experiment", hint: "SRX…" },
  { kind: "run", label: "Run", hint: "SRR…" },
  { kind: "bioproject", label: "BioProject", hint: "PRJ…" },
] as const

/** The outputs of the condition: record exports and accession lists. */
export const ExportMenu = ({ open, onClose, q, totalRecords }: ExportMenuProps) => {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const onClick = () => onClose()
    window.addEventListener("keydown", onKey)
    // Registered once the click that opened the menu has finished bubbling, so that click does not close it.
    const timer = setTimeout(() => window.addEventListener("click", onClick), 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("click", onClick)
    }
  }, [open, onClose])
  if (!open) return null
  const item = "flex justify-between rounded-button px-2 py-1.5 text-ink no-underline hover:bg-brand-soft"
  return (
    <div
      role="menu"
      onClick={(event) => event.stopPropagation()}
      className="absolute top-9 right-13 z-popover w-menu rounded-card border border-border-soft bg-surface p-2 text-fs-body-sm shadow-modal"
    >
      <div className="px-2 pt-1.5 pb-1 text-fs-label font-semibold text-ink-soft">Records (all annotation fields)</div>
      <DownloadLink role="menuitem" className={item} href={apiUrl("/api/export/records", { q: q ?? undefined, format: "tsv" })}>
        <span>Records · TSV</span>
        <span className="font-mono text-fs-label text-ink-soft">{totalRecords === undefined ? "" : `${formatCount(totalRecords)} rows`}</span>
      </DownloadLink>
      <DownloadLink role="menuitem" className={item} href={apiUrl("/api/export/records", { q: q ?? undefined, format: "json" })}>
        <span>Records · JSON lines</span>
      </DownloadLink>
      <div className="mt-1 border-t border-brand-soft px-2 pt-2.5 pb-1 text-fs-label font-semibold text-ink-soft">
        Accession lists (one per line)
      </div>
      {ACCESSION_KINDS.map(({ kind, label, hint }) => (
        <DownloadLink key={kind} role="menuitem" className={item} href={apiUrl("/api/export/accessions", { q: q ?? undefined, kind })}>
          <span>{label}</span>
          <span className="font-mono text-fs-label text-ink-soft">{hint}</span>
        </DownloadLink>
      ))}
    </div>
  )
}

type ApiModalProps = {
  open: boolean
  onClose: () => void
  state: WorkspaceState
  onToast: (message: string) => void
}

const TAB_LABELS: Record<WorkspaceState["tab"], string> = {
  samples: "Samples",
  distribution: "Distribution",
  heatmap: "Heatmap",
  trend: "Trend",
  projects: "Projects",
}

/** The api request that returns the current view. */
export const apiRequestFor = (state: WorkspaceState): string => {
  const q = state.q ?? undefined
  const se = state.selfExclusion ? undefined : "false"
  switch (state.tab) {
    case "samples":
      return apiUrl("/api/records", { q, unit: state.rows, page: state.page, per_page: 25 })
    case "distribution":
      return apiUrl("/api/distribution", { q, field: "disease", unit: state.unit, self_exclusion: se })
    case "heatmap":
      return apiUrl("/api/crosstab", {
        q,
        row: state.row,
        col: state.col,
        unit: state.unit,
        self_exclusion: se,
        row_elements: state.rowTerms?.join(","),
        col_elements: state.colTerms?.join(","),
      })
    case "trend":
      return apiUrl("/api/trend", { q, field: state.trendField ?? undefined, unit: state.unit, self_exclusion: se, elements: state.trendTerms?.join(",") })
    case "projects":
      return apiUrl("/api/projects", { q, self_exclusion: se, sort: "biosample", page: state.page, per_page: 25, composition_fields: "disease,cell_line,tissue" })
  }
}

export const ApiModal = ({ open, onClose, state, onToast }: ApiModalProps) => {
  const [response, setResponse] = useState<string>("")
  const request = apiRequestFor(state)
  const url = typeof window === "undefined" ? request : `${window.location.origin}${request}`
  const curl = `curl -s "${url}" \\\n  -H "Accept: application/json"`
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setResponse("")
    fetch(request)
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return
        try {
          const pretty = JSON.stringify(JSON.parse(text), null, 2)
          setResponse(pretty.length > 2500 ? `${pretty.slice(0, 2500)}\n  …` : pretty)
        } catch {
          setResponse(text.slice(0, 2500))
        }
      })
      .catch(() => setResponse("(request failed)"))
    return () => {
      cancelled = true
    }
  }, [open, request])
  return (
    <Modal open={open} onClose={onClose} width="lg" align="center" label="Same result via the API">
      <div className="flex items-center justify-between border-b border-border-soft px-4.5 py-3.5">
        <div>
          <div className="text-fs-h3 font-semibold">Same result via the API</div>
          <div className="text-fs-label text-ink-soft">Returns the {TAB_LABELS[state.tab]} view for the current condition. Same q, same unit.</div>
        </div>
        <LinkButton tone="soft" size="md" onClick={onClose} aria-label="Close">
          ×
        </LinkButton>
      </div>
      <div className="px-4.5 py-3.5">
        <div className="mb-1 text-fs-label font-semibold text-ink-soft">Request</div>
        <pre className="mb-3.5 rounded-button bg-ink px-3.5 py-3 font-mono text-fs-label leading-relaxed break-all whitespace-pre-wrap text-brand-soft">{curl}</pre>
        <div className="mb-1 text-fs-label font-semibold text-ink-soft">Response (excerpt)</div>
        <pre className="max-h-64 overflow-auto rounded-button border border-border-soft bg-surface-subtle px-3.5 py-3 font-mono text-fs-label leading-relaxed whitespace-pre-wrap text-ink-mid">
          {response || "Loading…"}
        </pre>
      </div>
      <div className="flex justify-between border-t border-border-soft px-4.5 py-2.5 text-fs-label text-ink-soft">
        <span>
          Pin <span className="font-mono">dataset_version</span> in scripts; counts change with each build.
        </span>
        <LinkButton
          onClick={async () => {
            onToast((await copyText(curl)) ? "curl copied" : "Copy failed")
          }}
        >
          Copy curl
        </LinkButton>
      </div>
    </Modal>
  )
}
