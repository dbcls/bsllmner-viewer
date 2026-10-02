import { type ReactNode, useEffect, useState } from "react"

import { apiUrl, exportAccessionsUrl, exportEntriesUrl } from "~/lib/api/client"
import { copyText } from "~/lib/export"
import { formatCount } from "~/lib/format"
import { TABLE_PER_PAGE } from "~/lib/workspace-state"
import { ACTION_ICON, CopyButton, DownloadLink, Icon, Modal } from "~/ui"

import type { WorkspaceState } from "./state"

type ExportMenuProps = {
  open: boolean
  onClose: () => void
  q: string | null
  totalEntries: number | undefined
}

const ACCESSION_TYPES = [
  { type: "biosample", label: "BioSample", hint: "SAMN…" },
  { type: "sra-experiment", label: "SRA Experiment", hint: "SRX…" },
  { type: "sra-run", label: "SRA Run", hint: "SRR…" },
  { type: "bioproject", label: "BioProject", hint: "PRJ…" },
] as const

type MenuGroupProps = {
  title: string
  note: string
  children: ReactNode
}

const MenuGroup = ({ title, note, children }: MenuGroupProps) => (
  <div role="group" aria-label={`${title} (${note})`} className="px-1.5 pt-2.5 pb-1">
    <div aria-hidden="true" className="mx-1.5 mb-1 flex items-baseline gap-1.5 border-b border-border-soft pb-1.5">
      <span className="border-l-4 border-brand pl-2 text-fs-body-sm leading-tight font-bold text-ink">{title}</span>
      <span className="text-fs-label text-ink-soft">{note}</span>
    </div>
    {children}
  </div>
)

type MenuItemProps = {
  href: string
  label: string
  hint?: string
}

const MenuItem = ({ href, label, hint }: MenuItemProps) => (
  <DownloadLink
    role="menuitem"
    href={href}
    className="flex items-center gap-2 rounded-button px-2 py-1.5 text-fs-body-sm text-ink no-underline hover:bg-brand-soft hover:text-brand-deep"
  >
    <Icon name={ACTION_ICON.download} className="text-brand" />
    <span className="flex-1">{label}</span>
    {hint && <span className="font-mono text-fs-label text-ink-soft">{hint}</span>}
  </DownloadLink>
)

/** The outputs of the condition: entry exports and accession lists. */
export const ExportMenu = ({ open, onClose, q, totalEntries }: ExportMenuProps) => {
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
  return (
    <div
      role="menu"
      onClick={(event) => event.stopPropagation()}
      className="absolute top-full right-0 z-popover mt-1.5 w-menu rounded-card border border-border-soft bg-surface pb-1.5 shadow-modal"
    >
      <MenuGroup title="Entries" note="all annotation fields">
        <MenuItem
          href={exportEntriesUrl("biosample", q, "tsv")}
          label="Entries · TSV"
          {...(totalEntries === undefined ? {} : { hint: `${formatCount(totalEntries)} rows` })}
        />
        <MenuItem href={exportEntriesUrl("biosample", q, "ndjson")} label="Entries · JSON lines" />
      </MenuGroup>
      <MenuGroup title="Accession lists" note="one per line">
        {ACCESSION_TYPES.map(({ type, label, hint }) => (
          <MenuItem key={type} href={exportAccessionsUrl(type, q)} label={label} hint={hint} />
        ))}
      </MenuGroup>
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
  const facetSelfExclude = state.selfExclusion ? "true" : undefined
  switch (state.tab) {
    case "samples":
      return apiUrl("/api/entries/biosample", { q, page: state.page, perPage: TABLE_PER_PAGE })
    case "distribution":
      return apiUrl("/api/distribution", { q, field: "disease", unit: state.unit, facetSelfExclude })
    case "heatmap":
      return apiUrl("/api/crosstab", {
        q,
        row: state.row,
        col: state.col,
        unit: state.unit,
        facetSelfExclude,
        rowElements: state.rowTerms?.join(","),
        colElements: state.colTerms?.join(","),
      })
    case "trend":
      return apiUrl("/api/trend", { q, field: state.trendField ?? undefined, unit: state.unit, facetSelfExclude, elements: state.trendTerms?.join(",") })
    case "projects":
      return apiUrl("/api/projects", { q, facetSelfExclude: "true", sort: state.sort, page: state.page, perPage: TABLE_PER_PAGE })
  }
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
        if (!cancelled) setResponse(responseExcerpt(text))
      })
      .catch(() => setResponse("(request failed)"))
    return () => {
      cancelled = true
    }
  }, [open, request])
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      align="center"
      title="Same result via the API"
      description={`Returns the ${TAB_LABELS[state.tab]} view for the current condition. Same q, same unit.`}
    >
      <div className="px-6 pb-6">
        <h3 className={BLOCK_HEADING}>Request</h3>
        <div className="relative mb-4">
          <pre className="rounded-button bg-ink py-3 pr-28 pl-3.5 font-mono text-fs-label leading-relaxed break-all whitespace-pre-wrap text-brand-soft">{curl}</pre>
          <span className="absolute top-2 right-2">
            <CopyButton
              kind="inverse"
              onCopy={async () => {
                const ok = await copyText(curl)
                if (!ok) onToast("Copy failed")
                return ok
              }}
            >
              Copy
            </CopyButton>
          </span>
        </div>
        <h3 className={BLOCK_HEADING}>Response (excerpt)</h3>
        <pre className="max-h-64 overflow-auto rounded-button border border-border-soft bg-surface-subtle px-3.5 py-3 font-mono text-fs-label leading-relaxed whitespace-pre-wrap text-ink-mid">
          {response || "Loading…"}
        </pre>
      </div>
    </Modal>
  )
}
